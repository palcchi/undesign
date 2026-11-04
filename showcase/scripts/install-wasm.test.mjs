import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const showcaseDirectory = resolve(testDirectory, "..");
const repositoryRoot = resolve(showcaseDirectory, "..");
const installerSource = join(testDirectory, "install-wasm.mjs");
const maxWasmBytes = 24 * 1024 * 1024;

const bootstrap = `import init, * as bindings from '/app/undesign-web-test.js';
const wasm = await init({ module_or_path: '/app/undesign-web-test_bg.wasm' });
window.wasmBindings = bindings;
dispatchEvent(new CustomEvent("TrunkApplicationStarted", {detail: {wasm}}));`;

function trunkHtml(script = `<script type="module">\n${bootstrap}\n</script>`) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="modulepreload" href="/app/undesign-web-test.js" crossorigin="anonymous" integrity="sha384-stale-js">
  <link rel="preload" href="/app/undesign-web-test_bg.wasm" crossorigin="anonymous" integrity="sha384-stale-wasm" as="fetch" type="application/wasm">
  ${script}
</head>
<body><canvas id="undesign_canvas"></canvas></body>
</html>`;
}

async function createFixture({ html = trunkHtml(), wasmSize = 16 } = {}) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "undesign-wasm-install-"));
  const projectRoot = join(temporaryRoot, "project");
  const scriptsDirectory = join(projectRoot, "scripts");
  const publicApp = join(projectRoot, "public", "app");
  const trunkDirectory = join(temporaryRoot, "trunk-output");
  await mkdir(scriptsDirectory, { recursive: true });
  await mkdir(publicApp, { recursive: true });
  await mkdir(trunkDirectory, { recursive: true });
  await copyFile(installerSource, join(scriptsDirectory, "install-wasm.mjs"));
  await writeFile(join(publicApp, "keep-on-validation-failure.txt"), "keep me");
  await writeFile(join(trunkDirectory, "index.html"), html);
  await writeFile(join(trunkDirectory, "undesign-web-test.js"), "export default async function init() { return {}; }\n");
  const wasmHandle = await open(join(trunkDirectory, "undesign-web-test_bg.wasm"), "w");
  await wasmHandle.truncate(wasmSize);
  await wasmHandle.close();
  return { temporaryRoot, projectRoot, publicApp, trunkDirectory };
}

function runInstaller(fixture) {
  return spawnSync(process.execPath, [join(fixture.projectRoot, "scripts", "install-wasm.mjs"), fixture.trunkDirectory], {
    cwd: fixture.projectRoot,
    encoding: "utf8",
  });
}

async function withFixture(options, run) {
  const fixture = await createFixture(options);
  try {
    await run(fixture);
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
}

test("installer externalizes the Trunk bootstrap and keeps SRI accurate", async () => {
  await withFixture({}, async (fixture) => {
    const result = runInstaller(fixture);
    assert.equal(result.status, 0, result.stderr);

    const runtimeHtml = await readFile(join(fixture.publicApp, "runtime.html"), "utf8");
    const bootstrapScriptTag = runtimeHtml.match(/<script\b[^>]*src="\/app\/trunk-bootstrap-[A-Za-z0-9_-]{64}\.js"[^>]*><\/script>/);
    assert.ok(bootstrapScriptTag, "runtime must load a hash-named external module");
    assert.doesNotMatch(runtimeHtml, /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script\s*>/i);
    assert.match(runtimeHtml, /name="undesign-runtime" content="true"/);

    const bootstrapFilename = /src="\/app\/([^\"]+)"/.exec(bootstrapScriptTag[0])?.[1];
    const bootstrapIntegrity = /\bintegrity="([^\"]+)"/.exec(bootstrapScriptTag[0])?.[1];
    assert.ok(bootstrapFilename);
    assert.ok(bootstrapIntegrity);
    const bootstrapBytes = await readFile(join(fixture.publicApp, bootstrapFilename));
    assert.equal(bootstrapIntegrity, `sha384-${createHash("sha384").update(bootstrapBytes).digest("base64")}`);
    const bootstrapSource = bootstrapBytes.toString("utf8");
    assert.match(bootstrapSource, /import init, \* as bindings/);
    assert.match(bootstrapSource, /TrunkApplicationStarted/);

    for (const assetName of ["undesign-web-test.js", "undesign-web-test_bg.wasm"]) {
      const assetBytes = await readFile(join(fixture.publicApp, assetName));
      const expectedIntegrity = `sha384-${createHash("sha384").update(assetBytes).digest("base64")}`;
      const link = (runtimeHtml.match(/<link\b[^>]*>/g) ?? []).find((tag) => tag.includes(`href="/app/${assetName}"`));
      assert.ok(link, `${assetName} must remain preloaded`);
      assert.ok(link.includes(`integrity="${expectedIntegrity}"`));
    }
  });
});

test("installer rejects missing or ambiguous inline bootstrap scripts before replacing installed assets", async (t) => {
  for (const [label, html] of [
    ["missing", trunkHtml("")],
    ["ambiguous", trunkHtml(`<script type="module">${bootstrap}</script><script>globalThis.extra = true;</script>`)],
    ["classic", trunkHtml(`<script>${bootstrap}</script>`)],
  ]) {
    await t.test(label, async () => {
      await withFixture({ html }, async (fixture) => {
        const result = runInstaller(fixture);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Expected exactly one inline Trunk bootstrap module|must be a non-empty module script/);
        assert.equal(await readFile(join(fixture.publicApp, "keep-on-validation-failure.txt"), "utf8"), "keep me");
      });
    });
  }
});

test("installer enforces the 24 MiB WASM cap before replacing installed assets", async () => {
  await withFixture({ wasmSize: maxWasmBytes + 1 }, async (fixture) => {
    const result = runInstaller(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /over the 25165824-byte WASM limit/);
    assert.equal(await readFile(join(fixture.publicApp, "keep-on-validation-failure.txt"), "utf8"), "keep me");
  });
});

test("current installed WASM assets remain below 24 MiB", async () => {
  const publicApp = join(showcaseDirectory, "public", "app");
  const wasmFiles = (await readdir(publicApp)).filter((name) => /\.wasm$/i.test(name));
  assert.ok(wasmFiles.length > 0, "the repository should include its installed Trunk WASM bundle");
  for (const name of wasmFiles) {
    const { size } = await stat(join(publicApp, name));
    assert.ok(size <= maxWasmBytes, `${name} is ${size} bytes; limit is ${maxWasmBytes}`);
  }
});

test("CSP remains strict and browser relay stays disabled by default", async () => {
  const vercelConfig = JSON.parse(await readFile(join(showcaseDirectory, "vercel.json"), "utf8"));
  const csp = vercelConfig.headers.flatMap((entry) => entry.headers).find((header) => header.key.toLowerCase() === "content-security-policy")?.value;
  assert.ok(csp);
  const scriptDirective = /(?:^|;)\s*script-src\s+([^;]+)/.exec(csp)?.[1];
  assert.ok(scriptDirective);
  assert.match(scriptDirective, /'self'/);
  assert.match(scriptDirective, /'wasm-unsafe-eval'/);
  assert.doesNotMatch(scriptDirective, /'unsafe-inline'|'nonce-[^']+'|sha(?:256|384|512)-/i);

  const cargoToml = await readFile(join(repositoryRoot, "apps", "undesign-web", "Cargo.toml"), "utf8");
  assert.match(cargoToml, /\[features\]\s*default\s*=\s*\[\]\s*agent-relay\s*=\s*\[\]/);
});

test("failed runtime iframe loads use safe document checks and retain retry recovery", async () => {
  const source = await readFile(join(showcaseDirectory, "src", "main.ts"), "utf8");
  const loadHandler = /frame\.addEventListener\("load", \(\) => \{([\s\S]*?)\n\s*\}\);/.exec(source)?.[1];
  assert.ok(loadHandler, "runtime iframe should have a load handler");
  assert.match(loadHandler, /if \(!runtimeRequested\) return;/);
  assert.match(loadHandler, /frame\.contentDocument/);
  assert.doesNotMatch(loadHandler, /contentWindow|location\.href/, "failed cross-origin documents must not throw a SecurityError");
  assert.match(loadHandler, /about:blank/);
  assert.match(loadHandler, /meta\[name="undesign-runtime"\]/);
  assert.match(loadHandler, /showRuntimeFailure\(copy\.app\.runtimeLoadError\)/);
  const retryHandler = /retry\.addEventListener\("click", \(\) => \{([\s\S]*?)\n\s*\}\);/.exec(source)?.[1];
  assert.ok(retryHandler, "runtime retry should have a click handler");
  assert.match(retryHandler, /frame\.isConnected/);
  assert.match(retryHandler, /loadRuntime\(\)/);
  assert.match(retryHandler, /startProbe\(\)/);
  assert.match(retryHandler, /loading\.focus\(/);
});

test("app routes omit outer shell chrome and fill the viewport", async () => {
  const source = await readFile(join(showcaseDirectory, "src", "main.ts"), "utf8");
  const css = await readFile(join(showcaseDirectory, "src", "styles.css"), "utf8");
  const appRenderer = /function buildAppShell\(\): void \{([\s\S]*?)\n\}\n\nasync function findInstalledRuntime/.exec(source)?.[1];
  assert.ok(appRenderer, "the app shell renderer should be present");
  assert.match(appRenderer, /root\.innerHTML = `[^`]*<main class="app-main"/);
  assert.doesNotMatch(appRenderer, /<header|app-header|app-back|judge-float-toggle|judge-panel|stub-banner|copy\.app\.(?:stubTitle|stubCopy|noRuntime)/);
  assert.doesNotMatch(appRenderer, /renderEditorStub|editor-stub|content\.innerHTML/);
  assert.doesNotMatch(source, /function renderEditorStub/);
  assert.match(source, /pathname === "\/showcase" \|\| pathname\.startsWith\("\/showcase\/"\)/);
  assert.match(source, /pathname === "\/" \|\| pathname === "\/app" \|\| pathname\.startsWith\("\/app\/"\)\)\s*\{\s*buildAppShell\(\)/);

  assert.match(css, /\.app-shell\s*\{[^}]*height:\s*100vh;\s*height:\s*100dvh;[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.app-main\s*\{[^}]*width:\s*100%;\s*height:\s*100%;[^}]*padding:\s*0/s);
  assert.match(css, /\.app-stage\s*\{[^}]*width:\s*100%;\s*height:\s*100%;[^}]*margin:\s*0/s);
  assert.match(css, /\.runtime-frame\s*\{[^}]*width:\s*100%;\s*height:\s*100%;[^}]*border:\s*0;\s*border-radius:\s*0/s);
  assert.doesNotMatch(css, /\.runtime-frame\s*\{[^}]*height:\s*calc\(/s);
  assert.doesNotMatch(css, /\.editor-stub|\.stub-banner|\.stub-editor|\.stub-toolbar/);
  assert.match(css, /\.app-loading\s*\{[^}]*padding:\s*24px/s);
});

test("runtime readiness and error messages enforce same-origin checks with a startup timeout", async () => {
  const source = await readFile(join(showcaseDirectory, "src", "main.ts"), "utf8");
  const messageHandler = /window\.addEventListener\("message", \(event: MessageEvent<unknown>\) => \{([\s\S]*?)\n\s*\}\);/.exec(source)?.[1];
  assert.ok(messageHandler, "runtime should listen for postMessage readiness");
  assert.match(messageHandler, /event\.origin !== window\.location\.origin/);
  assert.match(messageHandler, /event\.source !== frame\.contentWindow/);
  assert.match(messageHandler, /event\.data === RUNTIME_READY_MESSAGE/);
  assert.match(messageHandler, /showRuntimeReady\(\)/);
  assert.match(messageHandler, /event\.data === RUNTIME_ERROR_MESSAGE/);
  assert.match(messageHandler, /showRuntimeFailure\(copy\.app\.runtimeLoadError\)/);
  assert.match(source, /const RUNTIME_STARTUP_TIMEOUT_MS = 120_000;/);
  assert.match(source, /window\.setTimeout\(\(\) => showRuntimeFailure\(copy\.app\.runtimeTimeoutCopy\), RUNTIME_STARTUP_TIMEOUT_MS\)/);
});

test("routes keep showcase and app entry points", async () => {
  const source = await readFile(join(showcaseDirectory, "src", "main.ts"), "utf8");
  const router = /function renderCurrentRoute\(\): void \{([\s\S]*?)\n\}/.exec(source)?.[1];
  assert.ok(router, "router should be present");
  const showcaseBranch = /if \(pathname === "\/showcase" \|\| pathname\.startsWith\("\/showcase\/"\)\) \{([\s\S]*?)\} else if/.exec(router)?.[1];
  assert.ok(showcaseBranch, "/showcase should have a branch");
  assert.match(showcaseBranch, /renderHome\(\)/);
  assert.doesNotMatch(showcaseBranch, /buildAppShell/);
  const appBranch = /else if \(pathname === "\/" \|\| pathname === "\/app" \|\| pathname\.startsWith\("\/app\/"\)\) \{([\s\S]*?)\} else/.exec(router)?.[1];
  assert.ok(appBranch, "/ and /app should share a branch");
  assert.match(appBranch, /buildAppShell\(\)/);
  assert.doesNotMatch(appBranch, /renderHome/);
  assert.match(router, /else \{\s*renderHome\(\);?\s*\}/);
});

test("runtime probe is bounded and failures offer retry without a fake editor", async () => {
  const source = await readFile(join(showcaseDirectory, "src", "main.ts"), "utf8");
  assert.match(source, /const RUNTIME_PROBE_TIMEOUT_MS = 10_000;/);
  assert.match(source, /async function findInstalledRuntime\(timeoutMs: number = RUNTIME_PROBE_TIMEOUT_MS\)/);
  const probe = /async function findInstalledRuntime\([\s\S]*?\{([\s\S]*?)\n\}\n\nfunction renderCurrentRoute/.exec(source)?.[1];
  assert.ok(probe, "probe should be present");
  assert.match(probe, /AbortController/);
  assert.match(probe, /Promise\.race\(\[probe, timeout\]\)/);
  assert.match(probe, /controller\?\.abort\(\)/);
  assert.match(probe, /cache:\s*"no-store"/);
  assert.match(probe, /if \(!response\.ok\) return false;/);
  assert.match(probe, /name="undesign-runtime" content="true"/);
  assert.match(probe, /\} catch \{\s*return false;/);
  assert.match(probe, /window\.clearTimeout\(probeTimer\)/);
  const shell = /function buildAppShell\(\): void \{([\s\S]*?)\n\}\n\nasync function findInstalledRuntime/.exec(source)?.[1];
  assert.ok(shell);
  assert.doesNotMatch(shell, /renderEditorStub|editor-stub|content\.innerHTML/);
  assert.match(shell, /const startProbe = async \(\): Promise<void> => \{[\s\S]*?await findInstalledRuntime\(\)/);
  assert.match(shell, /if \(!runtimeInstalled\) \{\s*showRuntimeFailure\(copy\.app\.runtimeLoadError\);/);
  assert.match(shell, /if \(!hasRequiredBrowserSupport\(\)\) \{\s*showMessage\(copy\.app\.unsupportedTitle/);
});

test("app shell failure and ready states manage focus without stealing it", async () => {
  const source = await readFile(join(showcaseDirectory, "src", "main.ts"), "utf8");
  const shell = /function buildAppShell\(\): void \{([\s\S]*?)\n\}\n\nasync function findInstalledRuntime/.exec(source)?.[1];
  assert.ok(shell);
  const failure = /const showRuntimeFailure = \(detail: string\): void => \{([\s\S]*?)\n\s*\};/.exec(shell)?.[1];
  assert.ok(failure, "runtime failure should be present");
  assert.match(failure, /retry\.hidden = false/);
  assert.match(failure, /retry\.focus\(/);
  const notice = /const showMessage = \(title: string, detail: string\): void => \{([\s\S]*?)\n\s*\};/.exec(shell)?.[1];
  assert.ok(notice, "unsupported notice should be present");
  assert.match(notice, /heading\.tabIndex = -1/);
  assert.match(notice, /heading\.focus\(/);
  const idle = /const focusRuntimeFrameWhenIdle = \(\): void => \{([\s\S]*?)\n\s*\};/.exec(shell)?.[1];
  assert.ok(idle, "ready focus must be gated on user focus");
  assert.match(idle, /document\.activeElement/);
  assert.match(idle, /document\.body/);
  assert.match(idle, /frame\.focus\(/);
  const ready = /const showRuntimeReady = \(\): void => \{([\s\S]*?)\n\s*\};/.exec(shell)?.[1];
  assert.ok(ready);
  assert.match(ready, /focusRuntimeFrameWhenIdle\(\)/);
  assert.doesNotMatch(ready, /frame\.focus\(/, "ready must not focus unconditionally");
});

test("loading and error states keep phone inset without clipping", async () => {
  const css = await readFile(join(showcaseDirectory, "src", "styles.css"), "utf8");
  const phoneBlock = /@media \(max-width: 760px\) \{([\s\S]*?)\n\}/.exec(css)?.[1];
  assert.ok(phoneBlock, "phone breakpoint should be present");
  const loadingRule = /\.app-loading\s*\{([^}]*)\}/.exec(phoneBlock)?.[1];
  assert.ok(loadingRule, "loading state needs a phone rule");
  assert.match(loadingRule, /padding:\s*24px 20px/);
  const messageRule = /\.app-message\s*\{([^}]*)\}/.exec(phoneBlock)?.[1];
  assert.ok(messageRule, "error state needs a phone rule");
  assert.match(messageRule, /padding:\s*24px 20px/);
  assert.doesNotMatch(messageRule, /padding:\s*0 8px/);
});

test("committed runtime HTML keeps strict-CSP, SRI, and status semantics", async () => {
  const runtimeHtml = await readFile(join(showcaseDirectory, "public", "app", "runtime.html"), "utf8");
  assert.match(runtimeHtml, /name="undesign-runtime" content="true"/);
  assert.match(runtimeHtml, /<title>Undesign<\/title>/);
  assert.match(runtimeHtml, /<canvas id="undesign_canvas"/);
  assert.match(runtimeHtml, /id="undesign_loading" role="status"/);
  assert.match(runtimeHtml, /id="undesign_runtime_status" role="status"/);
  assert.doesNotMatch(runtimeHtml, /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script\s*>/i);
  assert.doesNotMatch(runtimeHtml, /\son\w+\s*=/i);
  assert.doesNotMatch(runtimeHtml, /javascript:/i);
  const scripts = [...runtimeHtml.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
  assert.ok(scripts.length > 0, "runtime should load an external bootstrap");
  for (const tag of scripts) {
    assert.match(tag, /\bsrc="/);
    assert.match(tag, /\bintegrity="sha384-/);
    assert.match(tag, /crossorigin="anonymous"/);
  }
  const preloads = [...runtimeHtml.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /rel="(?:modulepreload|preload)"/.test(tag));
  assert.ok(preloads.length > 0, "runtime should preload its bundle");
  for (const tag of preloads) {
    assert.match(tag, /\bintegrity="sha384-/);
    assert.match(tag, /crossorigin="anonymous"/);
  }
  const vercelConfig = JSON.parse(await readFile(join(showcaseDirectory, "vercel.json"), "utf8"));
  const csp = vercelConfig.headers.flatMap((entry) => entry.headers).find((header) => header.key.toLowerCase() === "content-security-policy")?.value;
  assert.ok(csp);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /frame-ancestors 'self'/);
});

test("Showcase light and dark app-shell tokens and favicon use grayscale", async () => {
  const css = await readFile(join(showcaseDirectory, "src", "styles.css"), "utf8");
  const svg = await readFile(join(showcaseDirectory, "public", "favicon.svg"), "utf8");
  for (const value of css.matchAll(/#[0-9a-f]{6}/gi)) {
    const hex = value[0].slice(1);
    assert.equal(hex.slice(0, 2), hex.slice(2, 4), `non-gray CSS token ${value[0]}`);
    assert.equal(hex.slice(2, 4), hex.slice(4, 6), `non-gray CSS token ${value[0]}`);
  }
  const faviconFill = /<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1];
  assert.ok(faviconFill);
  assert.equal(faviconFill.slice(1, 3), faviconFill.slice(3, 5));
  assert.equal(faviconFill.slice(3, 5), faviconFill.slice(5, 7));
});
