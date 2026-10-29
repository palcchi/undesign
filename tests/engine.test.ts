/**
 * Adapter tests: the typed engine boundary parses real-shaped payloads,
 * normalizes engine defaults, routes operations to the right commands, and
 * surfaces engine failures as EngineError. The handle is faked; the command
 * strings mirror the engine registry verified by `cargo test`.
 * Run with `npm test`.
 */
import { EngineAdapter, EngineError, parseEngineNode, parseEnginePages } from '../src/engine/adapter';
import type { WasmEngineInstance } from '../src/wasm/engine';

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

function assertThrows(fn: () => void, msg: string): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof EngineError) return;
    throw new Error(`${msg} (wrong error: ${(e as Error).message})`);
  }
  throw new Error(`${msg} (did not throw)`);
}

interface Script {
  calls: Array<{ cmd: string; params: string }>;
  results: Record<string, string>;
  fail?: string;
}

function fakeHandle(script: Script): WasmEngineInstance {
  return {
    execute(cmd: string, paramsJson: string): string {
      script.calls.push({ cmd, params: paramsJson });
      if (script.fail === cmd) throw new Error(`boom in ${cmd}`);
      const r = script.results[cmd];
      if (r === undefined) throw new Error(`unstubbed command ${cmd}`);
      return r;
    },
    undo: () => true,
    redo: () => false,
    undoDepth: () => '2,1',
    selection: () => '[4]',
    setSelection: (ids: string) => {
      script.calls.push({ cmd: 'setSelection', params: ids });
    },
    docInfo: () => '{"name":"d","pages":1}',
    describePage: () => '{"id":1,"name":"P","type":"PAGE","children":[]}',
    describeNode: () => '{"id":4,"name":"n","type":"RECTANGLE"}',
    hitTest: () => '{"id":6}',
    exportPageSvg: () => '<svg/>',
    save: () => '{"saved":true}',
    load: (json: string) => {
      script.calls.push({ cmd: 'load', params: json });
      if (json === 'bad') throw new Error('bad document JSON');
    },
  };
}

function adapter(script: Partial<Script> = {}): { api: EngineAdapter; calls: Script['calls'] } {
  const full: Script = { calls: [], results: {}, ...script };
  return { api: new EngineAdapter(fakeHandle(full)), calls: full.calls };
}

test('parseEngineNode normalizes engine defaults', () => {
  const n = parseEngineNode({ id: 7, name: 'R', type: 'RECTANGLE', x: 1, y: 2, width: 3, height: 4 });
  assert(n.visible === true, 'visible defaults true');
  assert(n.locked === false, 'locked defaults false');
  assert(n.opacity === 1, 'opacity defaults 1');
  assert(n.rotation === 0, 'rotation defaults 0');
  assert(n.fills.length === 0 && n.strokes.length === 0, 'paints default empty');
  assert(n.children.length === 0 && n.childCount === null, 'no children');
  assert(n.characters === null, 'no text fields on shapes');
  const t = parseEngineNode({
    id: 8, name: 'T', type: 'TEXT', characters: 'hi', fontFamily: 'F', fontSize: 12,
    textAlign: 'center', lineHeight: '140%', visible: false, locked: true, opacity: 0.5,
  });
  assert(t.visible === false && t.locked === true, 'flags read');
  assert(t.characters === 'hi' && t.lineHeight === '140%', 'text fields read');
  assertThrows(() => parseEngineNode(null), 'null rejected');
  assertThrows(() => parseEngineNode({ name: 'x' }), 'missing id rejected');
});

test('parseEnginePages validates the page list', () => {
  const pages = parseEnginePages([{ id: 1, name: 'A', current: true, children: 2 }]);
  assert(pages.length === 1 && pages[0].current === true, 'parsed');
  assertThrows(() => parseEnginePages({}), 'non-array rejected');
  assertThrows(() => parseEnginePages([{ name: 'x' }]), 'missing id rejected');
});

test('creation routes to the right commands with ids back', () => {
  const { api, calls } = adapter({ results: { 'shape.rectangle': '{"id":11}', 'node.create': '{"id":12}', 'text.create': '{"id":13}' } });
  assert(api.createShape('rectangle', { x: 1, y: 2, width: 3, height: 4, parent: 9 }) === 11, 'rect id');
  assert(api.createFrame({ x: 0, y: 0, width: 10, height: 10, name: 'F' }) === 12, 'frame id');
  assert(api.createText({ text: 'hi', x: 0, y: 0 }) === 13, 'text id');
  assert(calls[0].cmd === 'shape.rectangle', 'rect command');
  assert(JSON.parse(calls[0].params).parent === 9, 'parent passed');
  assert(JSON.parse(calls[1].params).type === 'frame', 'frame type');
  assert(JSON.parse(calls[2].params).text === 'hi', 'text passed');
});

test('editing ops send the documented params', () => {
  const { api, calls } = adapter({ results: { 'node.set': '{}', 'transform.move': '{}', 'transform.resize': '{}', 'edit.delete': '{}' } });
  api.setProps(4, { x: 9 });
  api.move([4, 5], 1, -2);
  api.resize([4], 30, undefined);
  api.remove([4]);
  api.move([], 1, 1);
  api.remove([]);
  assert(calls.length === 4, `empty selections skipped, got ${calls.length}`);
  assert(JSON.parse(calls[0].params).props.x === 9, 'set props');
  assert(JSON.parse(calls[1].params).dy === -2, 'move delta');
  assert(JSON.parse(calls[2].params).width === 30 && !('height' in JSON.parse(calls[2].params)), 'partial resize');
});

test('duplicate copies then pastes and returns pasted ids', () => {
  const { api, calls } = adapter({ results: { 'edit.copy': '{}', 'edit.paste': '{"ids":[21,22]}' } });
  const ids = api.duplicate([4], 9, 100, 200);
  assert(JSON.stringify(ids) === '[21,22]', 'pasted ids');
  assert(calls[0].cmd === 'edit.copy' && calls[1].cmd === 'edit.paste', 'copy then paste');
  assert(JSON.parse(calls[1].params).x === 100, 'paste position');
  assert(api.duplicate([]).length === 0, 'empty duplicate no-op');
});

test('selection, hit test, and marquee parse engine output', () => {
  const { api, calls } = adapter({
    results: {
      'select.layersAt': '{"layers":[{"id":4,"name":"R","type":"RECTANGLE"}]}',
      'select.area': '{"selection":[4,5]}',
      'select.none': '{}',
    },
  });
  assert(JSON.stringify(api.selection()) === '[4]', 'selection parsed');
  api.setSelection([4, 5]);
  assert(calls[0].params === '[4,5]', 'selection serialized');
  const hits = api.hitTest(10, 20);
  assert(hits.length === 1 && hits[0].type === 'RECTANGLE', 'hit parsed');
  assert(JSON.parse(calls[1].params).x === 10, 'hit coords');
  assert(JSON.stringify(api.marquee(0, 0, 50, 50)) === '[4,5]', 'marquee selection');
  api.clearSelection();
  assert(calls[calls.length - 1].cmd === 'select.none', 'clear');
});

test('hitTop resolves one click target or null', () => {
  const { api } = adapter();
  assert(api.hitTop(10, 20) === 6, 'id parsed');
  const full: Script = { calls: [], results: {} };
  const empty = new EngineAdapter({ ...fakeHandle(full), hitTest: () => 'null' });
  assert(empty.hitTop(0, 0) === null, 'null on empty canvas');
  const broken = new EngineAdapter({ ...fakeHandle(full), hitTest: () => 'oops' });
  assertThrows(() => broken.hitTop(0, 0), 'bad JSON wrapped');
});

test('history, svg, and persistence delegate with depth parsing', () => {
  const { api } = adapter();
  assert(api.undo() === true && api.redo() === false, 'undo/redo');
  assert(JSON.stringify(api.undoDepth()) === '[2,1]', 'depth parsed');
  assert(api.svg() === '<svg/>', 'svg');
  assert(api.save() === '{"saved":true}', 'save');
});

test('engine failures surface as EngineError', () => {
  const { api } = adapter({ fail: 'node.set', results: { 'node.set': '{}' } });
  assertThrows(() => api.setProps(4, {}), 'execute failure wrapped');
  const bad = adapter({ results: { 'page.list': 'oops' } });
  assertThrows(() => bad.api.pages(), 'bad JSON wrapped');
  const missing = adapter({ results: { 'shape.rectangle': '{}' } });
  assertThrows(() => missing.api.createShape('rectangle', { x: 0, y: 0, width: 1, height: 1 }), 'missing id rejected');
  const { api: loadApi } = adapter();
  assertThrows(() => loadApi.load('bad'), 'load failure wrapped');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL ENGINE ADAPTER TESTS PASSED');
