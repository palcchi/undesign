/**
 * Regression tests for the AI plan boundary (schema validation, object
 * building, selection patches). Network calls are browser-only and untested.
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import {
  aiConfigured,
  aiSelectionPatch,
  buildAiObjects,
  loadAiConfig,
  summarizeAiPlan,
  validateAiPlan,
} from '../src/ai';

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

test('valid plan with all op kinds passes', () => {
  const r = validateAiPlan({
    ops: [
      { op: 'add', type: 'frame', x: 0, y: 0, w: 200, h: 100, fill: '#ffffff' },
      { op: 'add', type: 'text', x: 10, y: 10, w: 100, h: 20, text: 'Hi', fontSize: 18 },
      { op: 'setFill', color: '#ff0000' },
      { op: 'setText', text: 'New' },
    ],
  });
  assert(r.ok && r.ops.length === 4, 'accepted');
});

test('malformed plans fail with reasons', () => {
  assert(!validateAiPlan(null).ok, 'null');
  assert(!validateAiPlan({}).ok, 'no ops');
  assert(!validateAiPlan({ ops: [] }).ok, 'empty');
  assert(!validateAiPlan({ ops: [{ op: 'mystery' }] }).ok, 'unknown op');
  assert(!validateAiPlan({ ops: [{ op: 'add', type: 'star', x: 0, y: 0, w: 1, h: 1 }] }).ok, 'bad type');
  assert(!validateAiPlan({ ops: [{ op: 'add', type: 'rectangle', x: 0, y: 0, w: 0, h: 5 }] }).ok, 'zero width');
  assert(
    !validateAiPlan({ ops: [{ op: 'add', type: 'rectangle', x: NaN, y: 0, w: 5, h: 5 }] }).ok,
    'NaN coordinate',
  );
  assert(!validateAiPlan({ ops: [{ op: 'setFill', color: 'red' }] }).ok, 'named color');
  assert(!validateAiPlan({ ops: [{ op: 'setFill', color: '#FFF' }] }).ok, 'short hex');
  assert(!validateAiPlan({ ops: [{ op: 'setText', text: '' }] }).ok, 'empty text');
  const big = { ops: Array.from({ length: 51 }, () => ({ op: 'setFill', color: '#112233' })) };
  assert(!validateAiPlan(big).ok, 'over the op cap');
});

test('one bad op rejects the whole plan', () => {
  const r = validateAiPlan({
    ops: [
      { op: 'add', type: 'rectangle', x: 0, y: 0, w: 5, h: 5 },
      { op: 'explode' },
    ],
  });
  assert(!r.ok, 'rejected');
});

test('extra fields are ignored, required shape enforced', () => {
  const r = validateAiPlan({ ops: [{ op: 'setFill', color: '#112233', mood: 'bold' }], model: 'x' });
  assert(r.ok && r.ops.length === 1, 'extras tolerated');
});

test('buildAiObjects produces valid document objects', () => {
  let n = 0;
  const objs = buildAiObjects(
    [
      { op: 'add', type: 'text', x: 1, y: 2, w: 30, h: 10, text: 'T', fontSize: 20 },
      { op: 'add', type: 'frame', x: 0, y: 0, w: 50, h: 50 },
      { op: 'setFill', color: '#112233' },
    ],
    () => `id${(n += 1)}`,
  );
  assert(objs.length === 2, 'add ops only');
  assert(objs[0].id === 'id1' && objs[1].id === 'id2', 'fresh ids');
  assert(objs[0].text === 'T' && objs[0].fontSize === 20, 'text carried');
  assert(objs[1].clip === true && objs[1].parentId === null, 'frame defaults');
  assert(objs.every((o) => o.visible && !o.locked && o.fillStyleId === null), 'sane flags');
});

test('aiSelectionPatch merges edits, last wins', () => {
  assert(aiSelectionPatch([{ op: 'add', type: 'rectangle', x: 0, y: 0, w: 1, h: 1 }]) === null, 'adds ignored');
  const p = aiSelectionPatch([
    { op: 'setFill', color: '#111111' },
    { op: 'setText', text: 'A' },
    { op: 'setFill', color: '#222222' },
  ]);
  assert(p?.fill === '#222222' && p?.text === 'A', 'merged');
  assert(p?.fillStyleId === null, 'recolor detaches style link');
});

test('summarizeAiPlan describes the preview', () => {
  assert(
    summarizeAiPlan([
      { op: 'add', type: 'rectangle', x: 0, y: 0, w: 1, h: 1 },
      { op: 'add', type: 'rectangle', x: 0, y: 0, w: 1, h: 1 },
      { op: 'setFill', color: '#112233' },
    ]) === '2 new objects + 1 selection edit',
    'counts',
  );
});

test('config helpers are safe without a browser', () => {
  assert(!aiConfigured(loadAiConfig()), 'empty by default here');
  assert(!aiConfigured({ baseUrl: 'http://x', apiKey: '', model: 'm' }), 'key required');
  assert(aiConfigured({ baseUrl: 'http://x', apiKey: 'k', model: 'm' }), 'complete passes');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL AI TESTS PASSED');
