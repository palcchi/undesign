// Real-engine end-to-end: bundles scripts/e2e-driver.ts (real converter,
// readback, and adapter against the real built WASM) and runs it in node.
// Requires `npm run build:wasm` first; fails loudly otherwise.
import { buildSync } from 'esbuild';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
process.env.UNDESIGN_ROOT = root;
const glue = join(root, 'src', 'wasm', 'pkg', 'undesign_wasm.js');
if (!existsSync(glue)) {
  console.error('missing WASM build output — run `npm run build:wasm` first.');
  process.exit(2);
}
const out = join(tmpdir(), `undesign-e2e-${process.pid}.mjs`);
buildSync({
  entryPoints: [join(here, 'e2e-driver.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'error',
});
await import(pathToFileURL(out).href);
