// Minimal test runner: bundles every tests/*.test.ts with the project's own
// esbuild (ships with Vite, no new dependencies) and executes them with node.
import { buildSync } from 'esbuild';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.ts'))
  .sort();
if (files.length === 0) throw new Error('No test files found in tests/');

for (const f of files) {
  console.log(`--- ${f} ---`);
  const out = join(tmpdir(), `undesign-test-${process.pid}-${f}.mjs`);
  buildSync({
    entryPoints: [join(here, f)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'error',
  });
  await import(pathToFileURL(out).href);
}
