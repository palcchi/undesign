/**
 * Regression tests for PNG export scaling (pure SVG dimension rewriting).
 * Rasterization itself needs a browser canvas and is not covered here.
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { scaledSvg } from '../src/exportPng';

let failures = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL  ${name} — ${(e as Error).message}`);
  }
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">\n</svg>\n';

test('scale 1 keeps dimensions', () => {
  const { svg, w, h } = scaledSvg(SVG, 1);
  assert(w === 100 && h === 50, 'size');
  assert(svg.includes('width="100"') && svg.includes('height="50"'), 'attrs');
  assert(svg.includes('viewBox="0 0 100 50"'), 'viewBox untouched');
});

test('scale 2 doubles pixel dimensions only', () => {
  const { svg, w, h } = scaledSvg(SVG, 2);
  assert(w === 200 && h === 100, 'size');
  assert(svg.includes('width="200"') && svg.includes('height="100"'), 'attrs');
  assert(svg.includes('viewBox="0 0 100 50"'), 'viewBox untouched');
});

test('fractional source dimensions round up to whole pixels', () => {
  const { w, h } = scaledSvg(SVG.replace('width="100"', 'width="33.3"'), 3);
  assert(w === 100 && h === 150, `got ${w}x${h}`);
});

test('malformed svg falls back to a sane default', () => {
  const { w, h, svg } = scaledSvg('<svg></svg>', 2);
  assert(w === 1600 && h === 1200, `got ${w}x${h}`);
  assert(typeof svg === 'string', 'string out');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL PNG TESTS PASSED');
