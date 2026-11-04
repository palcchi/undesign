import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceArgument = process.argv[2];

if (!sourceArgument) {
  console.error("Usage: node scripts/install-wasm.mjs /path/to/trunk/dist/web");
  process.exit(2);
}

const sourceDirectory = resolve(process.cwd(), sourceArgument);
const sourceIndex = resolve(sourceDirectory, "index.html");
const publicApp = resolve(projectRoot, "public/app");
let sourceHtml;

try {
  sourceHtml = await readFile(sourceIndex, "utf8");
} catch {
  console.error(`Trunk index.html was not found in ${sourceDirectory}`);
  process.exit(1);
}

if (!sourceHtml.includes("</head>")) {
  console.error("The Trunk index.html does not contain a closing head element.");
  process.exit(1);
}

// 28 MiB: the browser build with the embedded Latin fonts is about 25.5 MB (2026-11-04).
const maxWasmBytes = Number(process.env.UNDESIGN_WASM_MAX_BYTES ?? "29360128");
if (!Number.isSafeInteger(maxWasmBytes) || maxWasmBytes < 1) {
  console.error("UNDESIGN_WASM_MAX_BYTES must be a positive safe integer.");
  process.exit(1);
}

const sourceEntries = await readdir(sourceDirectory, { withFileTypes: true });
const wasmEntries = sourceEntries.filter((entry) => entry.isFile() && /\.wasm$/i.test(entry.name));
if (wasmEntries.length === 0) {
  console.error(`No .wasm files were found in ${sourceDirectory}`);
  process.exit(1);
}
for (const entry of wasmEntries) {
  const size = (await stat(resolve(sourceDirectory, entry.name))).size;
  if (size > maxWasmBytes) {
    console.error(`${entry.name} is ${size} bytes, over the ${maxWasmBytes}-byte WASM limit.`);
    process.exit(1);
  }
}

sourceHtml = sourceHtml.replace(/^[\t ]+$/gm, "");
const marker = '<meta name="undesign-runtime" content="true">';
let runtimeHtml = sourceHtml.includes('name="undesign-runtime"')
  ? sourceHtml
  : sourceHtml.replace("</head>", `  ${marker}\n</head>`);

const scriptTags = [...runtimeHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
const inlineScripts = scriptTags.filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes));
if (inlineScripts.length !== 1) {
  console.error(`Expected exactly one inline Trunk bootstrap module; found ${inlineScripts.length}.`);
  process.exit(1);
}

const [inlineBootstrap, bootstrapAttributes, bootstrapBody] = inlineScripts[0];
if (!/\btype\s*=\s*(?:"module"|'module'|module)(?:\s|$)/i.test(bootstrapAttributes) || !bootstrapBody.trim()) {
  console.error("The inline Trunk bootstrap must be a non-empty module script.");
  process.exit(1);
}
if (scriptTags.some(([, attributes, body]) => /\bsrc\s*=/i.test(attributes) && body.trim())) {
  console.error("Unsupported inline content was found inside an external script tag.");
  process.exit(1);
}

const bootstrapBytes = Buffer.from(`${bootstrapBody.trim()}\n`, "utf8");
const bootstrapDigest = createHash("sha384").update(bootstrapBytes).digest();
const bootstrapIntegrity = `sha384-${bootstrapDigest.toString("base64")}`;
const bootstrapFilename = `trunk-bootstrap-${bootstrapDigest.toString("base64url")}.js`;
const externalBootstrap = `<script type="module" src="/app/${bootstrapFilename}" integrity="${bootstrapIntegrity}" crossorigin="anonymous"></script>`;
runtimeHtml = runtimeHtml.replace(inlineBootstrap, externalBootstrap);

const remainingInlineScripts = [...runtimeHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(([, attributes, body]) => !/\bsrc\s*=/i.test(attributes) && body.trim());
if (remainingInlineScripts.length > 0) {
  console.error("Inline executable scripts remain in the Trunk runtime HTML.");
  process.exit(1);
}

await rm(publicApp, { recursive: true, force: true });
await mkdir(publicApp, { recursive: true });

for (const entry of sourceEntries) {
  if (entry.name === "index.html" || entry.name === ".DS_Store" || entry.name === ".trunk-lock") continue;
  const source = resolve(sourceDirectory, entry.name);
  const target = resolve(publicApp, entry.name);
  if (entry.isDirectory()) {
    await cp(source, target, { recursive: true });
  } else if (entry.isFile()) {
    await cp(source, target);
    if (entry.name.endsWith(".js")) {
      const javascript = await readFile(target, "utf8");
      const cleaned = javascript.replace(
        /^[\t ]*\/\/[^\r\n]*we could test for more things here, like `Set`s and `Map`s\.[\t ]*\r?\n/gm,
        "",
      );
      if (cleaned !== javascript) await writeFile(target, cleaned, "utf8");
    }
  }
}

await writeFile(resolve(publicApp, bootstrapFilename), bootstrapBytes);

const installedFiles = (await readdir(publicApp)).filter((name) => name !== "runtime.html");
if (installedFiles.some((name) => basename(name) === "index.html")) {
  console.error("Unexpected index.html found in the app asset directory.");
  process.exit(1);
}

const integrityByName = new Map();
for (const name of installedFiles) {
  if (!/\.(?:js|mjs|wasm)$/i.test(name)) continue;
  const bytes = await readFile(resolve(publicApp, name));
  const digest = createHash("sha384").update(bytes).digest("base64");
  integrityByName.set(name, `sha384-${digest}`);
}

const synchronizedRuntimeHtml = runtimeHtml.replace(/<link\b[^>]*>/g, (tag) => {
  const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
  const assetPath = href?.split(/[?#]/, 1)[0];
  if (!assetPath || /^(?:[a-z]+:)?\/\//i.test(assetPath)) return tag;
  const assetName = assetPath.split("/").pop();
  const integrity = assetName ? integrityByName.get(assetName) : undefined;
  if (!integrity || !/\bintegrity="[^"]*"/.test(tag)) return tag;
  return tag.replace(/\bintegrity="[^"]*"/, `integrity="${integrity}"`);
});
await writeFile(resolve(publicApp, "runtime.html"), synchronizedRuntimeHtml, "utf8");

console.log(`Installed ${installedFiles.length} Trunk asset entries under public/app; the /app shell remains the page entry.`);
