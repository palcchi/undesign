/**
 * Draw-commit tests: creation drags resolve to the engine calls the ghost
 * preview shows, including the FigCraft shape tools (polygon/star/arrow).
 * Run with `npm test`.
 */
import { defaultDrawSize, drawParamsForTool } from '../src/engine/draw';

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

test('non-drawing tools never commit', () => {
  assert(drawParamsForTool('select', { x: 0, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 0 }, 1) === null, 'select');
  assert(drawParamsForTool('hand', { x: 0, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 0 }, 1) === null, 'hand');
});

test('box drags keep the parent-adjusted origin and page-space size', () => {
  const r = drawParamsForTool('rectangle', { x: 200, y: 100 }, { x: 100, y: 40 }, { x: 10, y: 5 }, 1);
  assert(r !== null && r.kind === 'shape' && r.shape === 'rectangle', 'shape kind');
  if (r !== null && r.kind === 'shape') {
    assert(r.x === 10 && r.y === 5 && r.w === 100 && r.h === 60, `rect, got ${r.x},${r.y} ${r.w}x${r.h}`);
  }
});

test('tiny drags fall back to per-tool click sizes', () => {
  assert(JSON.stringify(defaultDrawSize('frame')) === '{"w":300,"h":200}', 'frame');
  assert(JSON.stringify(defaultDrawSize('ellipse')) === '{"w":80,"h":80}', 'ellipse');
  assert(JSON.stringify(defaultDrawSize('polygon')) === '{"w":80,"h":80}', 'polygon');
  assert(JSON.stringify(defaultDrawSize('star')) === '{"w":80,"h":80}', 'star');
  assert(JSON.stringify(defaultDrawSize('rectangle')) === '{"w":100,"h":60}', 'rectangle default');
  const tiny = drawParamsForTool('polygon', { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 7, y: 9 }, 1);
  assert(tiny !== null && tiny.kind === 'shape' && tiny.w === 80 && tiny.h === 80, 'polygon click size');
  if (tiny !== null && tiny.kind === 'shape') {
    assert(tiny.x === 7 && tiny.y === 9, 'click keeps origin');
  }
});

test('lines and arrows order endpoints and stay page-root', () => {
  const l = drawParamsForTool('line', { x: 60, y: 10 }, { x: 10, y: 40 }, { x: 0, y: 0 }, 1);
  assert(l !== null && l.kind === 'shape' && l.shape === 'line', 'line kind');
  if (l !== null && l.kind === 'shape') {
    assert(l.x === 10 && l.y === 40 && l.w === 50 && l.h === -30, `ordered, got ${l.x},${l.y} ${l.w}x${l.h}`);
  }
  const a = drawParamsForTool('arrow', { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 99, y: 99 }, 1);
  assert(a !== null && a.kind === 'shape' && a.shape === 'arrow', 'arrow kind');
  if (a !== null && a.kind === 'shape') {
    assert(a.x === 0 && a.y === 0 && a.w === 40 && a.h === 0, 'arrow ignores local (page root)');
  }
});

test('sub-click line drags do not commit', () => {
  assert(drawParamsForTool('line', { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 0 }, 1) === null, 'too short at zoom 1');
  const zoomed = drawParamsForTool('line', { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 0 }, 8);
  assert(zoomed !== null, 'same drag commits at zoom 8');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL DRAW TESTS PASSED');
