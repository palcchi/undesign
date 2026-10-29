/**
 * Regression tests for prototype links (validation, pruning, editing).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { outgoingLink, pruneLinks, setOutgoingLink } from '../src/prototype';
import type { DocPage, PrototypeLink } from '../src/types';

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

function pages(): DocPage[] {
  return [
    {
      id: 'p', name: 'p',
      objects: [
        { id: 'btn', type: 'rectangle' },
        { id: 'home', type: 'frame' },
        { id: 'about', type: 'frame' },
      ] as DocPage['objects'],
    },
  ];
}

function link(id: string, sourceId: string, targetFrameId: string): PrototypeLink {
  return { id, sourceId, targetFrameId };
}

test('pruneLinks drops dangling and non-frame targets', () => {
  const out = pruneLinks(pages(), [
    link('l1', 'btn', 'about'),
    link('l2', 'gone', 'about'),
    link('l3', 'btn', 'gone'),
    link('l4', 'btn', 'btn'),
  ]);
  assert(out.length === 1 && out[0].id === 'l1', 'only the valid link survives');
});

test('outgoingLink finds the source link', () => {
  const links = [link('l1', 'btn', 'about')];
  assert(outgoingLink(links, 'btn')?.targetFrameId === 'about', 'found');
  assert(outgoingLink(links, 'home') === null, 'none');
});

test('setOutgoingLink replaces, clears, and preserves refs', () => {
  const links = [link('l1', 'btn', 'home'), link('l2', 'x', 'about')];
  const moved = setOutgoingLink(links, 'btn', 'about', () => 'new');
  assert(moved.find((l) => l.sourceId === 'btn')?.targetFrameId === 'about', 'retargeted');
  assert(moved.find((l) => l.sourceId === 'btn')?.id === 'l1', 'id preserved');
  assert(moved.length === 2, 'one link per source');
  assert(setOutgoingLink(links, 'btn', 'home', () => 'new') === links, 'unchanged target no-op');
  const cleared = setOutgoingLink(links, 'btn', null, () => 'new');
  assert(cleared.length === 1 && cleared[0].id === 'l2', 'cleared');
  assert(setOutgoingLink(links, 'zzz', null, () => 'new') === links, 'clear missing no-op');
  const added = setOutgoingLink(links, 'home', 'about', () => 'l3');
  assert(added.length === 3 && added[2].id === 'l3', 'added with fresh id');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL PROTOTYPE TESTS PASSED');
