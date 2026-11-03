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
