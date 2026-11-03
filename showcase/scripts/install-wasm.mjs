import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

sourceHtml = sourceHtml.replace(/^[\t ]+$/gm, "");

await rm(publicApp, { recursive: true, force: true });
await mkdir(publicApp, { recursive: true });

for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
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

const marker = '<meta name="undesign-runtime" content="true">';
const runtimeHtml = sourceHtml.includes('name="undesign-runtime"')
  ? sourceHtml
  : sourceHtml.replace("</head>", `  ${marker}\n</head>`);

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
