/**
 * Overlay geometry tests: local→page composition, nesting, inversion, and —
 * most importantly — agreement with real engine `absoluteBounds` from the
 * captured fixture (including a rotated node). Run with `npm test`.
 */
import { chainToPageMatrix, findChain, pageBounds, pageCorners, pageToLocal } from '../src/engine/geometry';
import { parseEngineNode, type EngineNode } from '../src/engine/adapter';
// @ts-ignore: JSON fixture import (esbuild bundles it; tsc never sees tests).
import snapshotJson from './fixtures/engine-tree.json';

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

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function node(over: Partial<EngineNode> = {}): EngineNode {
  return {
    id: 1, name: 'n', type: 'RECTANGLE', x: 0, y: 0, width: 0, height: 0,
    rotation: 0, absoluteBounds: null, visible: true, locked: false, opacity: 1,
    fills: [], strokes: [], strokeWeight: 0, cornerRadius: null, clip: false,
    characters: null, fontFamily: null, fontStyle: null, fontSize: null,
    textAlign: null, lineHeight: null, children: [], childCount: null,
    ...over,
  };
}

test('unrotated nodes map their local box to page space', () => {
  const n = node({ x: 10, y: 20, width: 100, height: 50 });
  const [a, b, c, d] = pageCorners(n, []);
  assert(a.x === 10 && a.y === 20, 'tl');
  assert(b.x === 110 && b.y === 20, 'tr');
  assert(c.x === 110 && c.y === 70, 'br');
  assert(d.x === 10 && d.y === 70, 'bl');
});

test('engine rotation runs counter-clockwise on screen', () => {
  const n = node({ x: 10, y: 20, width: 100, height: 50, rotation: 90 });
  const [a, b, c, d] = pageCorners(n, []);
  assert(approx(a.x, 10) && approx(a.y, 20), `origin fixed, got ${a.x},${a.y}`);
  assert(approx(b.x, 10) && approx(b.y, -80), `east edge swings north, got ${b.x},${b.y}`);
  assert(approx(c.x, 60) && approx(c.y, -80), `br, got ${c.x},${c.y}`);
  assert(approx(d.x, 60) && approx(d.y, 20), `bl, got ${d.x},${d.y}`);
});

test('nested chains compose through ancestors', () => {
  const frame = node({ id: 1, type: 'FRAME', x: 10, y: 20, width: 300, height: 200 });
  const kid = node({ id: 2, x: 5, y: 5, width: 20, height: 10 });
  const [a] = pageCorners(kid, [frame]);
  assert(a.x === 15 && a.y === 25, 'parent offset applied');
  const back = pageToLocal(kid, [frame], { x: 15, y: 25 });
  assert(back !== null && approx(back.x, 0) && approx(back.y, 0), 'inverse round-trips');
});

test('findChain locates nested nodes root-first', () => {
  const kid = node({ id: 3 });
  const frame = node({ id: 2, children: [kid] });
  const root = node({ id: 1, type: 'PAGE', children: [frame] });
  const chain = findChain(root, 3);
  assert(chain !== null && chain.map((n) => n.id).join(',') === '1,2,3', 'chain order');
  assert(findChain(root, 99) === null, 'missing id is null');
});

test('composed bounds agree with real engine absoluteBounds', () => {
  const snap = snapshotJson as { trees: Record<string, unknown> };
  const root = parseEngineNode(snap.trees['1']);
  const check = (n: EngineNode, ancestors: EngineNode[]): void => {
    if (n.absoluteBounds && n.type !== 'PAGE') {
      const b = pageBounds(n, ancestors);
      const e = n.absoluteBounds;
      assert(
        approx(b.x, e.x, 0.05) && approx(b.y, e.y, 0.05) && approx(b.w, e.width, 0.05) && approx(b.h, e.height, 0.05),
        `${n.name}: composed (${b.x.toFixed(2)},${b.y.toFixed(2)} ${b.w.toFixed(2)}x${b.h.toFixed(2)}) matches engine (${e.x},${e.y} ${e.width}x${e.height})`,
      );
    }
    for (const c of n.children) check(c, [...ancestors, n]);
  };
  check(root, []);
  const chip = findChain(root, root.children[0].children[0].id);
  assert(chip !== null && (chip[chip.length - 1] as EngineNode).rotation === 30, 'fixture covers a rotated node');
});

test('chainToPageMatrix of an empty chain is identity', () => {
  const m = chainToPageMatrix([]);
  assert(m.a === 1 && m.d === 1 && m.e === 0 && m.f === 0, 'identity');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL GEOMETRY TESTS PASSED');
