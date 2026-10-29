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

test('polygon, star, and arrow route to shape commands with props', () => {
  const { api, calls } = adapter({
    results: { 'shape.polygon': '{"id":31}', 'shape.star': '{"id":32}', 'shape.arrow': '{"id":33}' },
  });
  assert(api.createShape('polygon', { x: 0, y: 0, width: 10, height: 10, props: { pointCount: 6 } }) === 31, 'polygon id');
  assert(api.createShape('star', { x: 0, y: 0, width: 10, height: 10, props: { pointCount: 5, innerRadius: 0.5 } }) === 32, 'star id');
  assert(api.createShape('arrow', { x: 0, y: 5, width: 40 }) === 33, 'arrow id');
  assert(calls[0].cmd === 'shape.polygon', 'polygon command');
  assert(JSON.parse(calls[0].params).props.pointCount === 6, 'polygon props');
  assert(JSON.parse(calls[1].params).props.innerRadius === 0.5, 'star props');
  assert(!('height' in JSON.parse(calls[2].params)), 'arrow is length-only like lines');
});

test('frame, mask, rasterize, and move-to-page ops send verified params', () => {
  const { api, calls } = adapter({
    results: {
      'object.frameSelection': '{"id":41}',
      'object.removeFrame': '{}',
      'frame.swapOrientation': '{}',
      'frame.presets': '[{"category":"Phone","name":"iPhone","width":393,"height":852}]',
      'object.mask': '{"id":42}',
      'object.releaseMask': '{}',
      'object.rasterize': '{"ids":[43]}',
      'object.moveToPage': '{}',
    },
  });
  assert(api.frameSelection([4, 5], 'Card') === 41, 'frame id');
  assert(JSON.parse(calls[0].params).name === 'Card', 'frame name');
  api.removeFrame([41]);
  api.swapOrientation([41]);
  const presets = api.framePresets();
  assert(presets.length === 1 && presets[0].width === 393, 'presets parsed');
  assert(api.mask([4, 5]) === 42, 'mask group id');
  api.releaseMask([4]);
  api.rasterize([4], 2);
  assert(JSON.parse(calls[calls.length - 1].params).scale === 2, 'raster scale');
  api.moveToPage([4], 2);
  assert(JSON.parse(calls[calls.length - 1].params).page === 2, 'target page');
  api.removeFrame([]);
  api.mask([]);
  api.rasterize([], 2);
  assert(calls.length === 8, `empty frame/mask/raster skipped, got ${calls.length}`);
});

test('booleans and auto-layout bridge the structure commands', () => {
  const { api, calls } = adapter({
    results: {
      'bool.union': '{"id":51}', 'bool.subtract': '{"id":51}', 'bool.intersect': '{"id":51}',
      'bool.exclude': '{"id":51}', 'bool.flatten': '{}', 'layout.add': '{}', 'layout.remove': '{}',
    },
  });
  api.booleanCombine([4, 5], 'union');
  api.booleanCombine([4, 5], 'subtract');
  api.booleanCombine([4, 5], 'intersect');
  api.booleanCombine([4, 5], 'exclude');
  api.flattenBoolean([51]);
  api.layoutAdd([51], 'horizontal');
  api.layoutRemove([51]);
  const cmds = calls.map((c) => c.cmd);
  assert(JSON.stringify(cmds) === '["bool.union","bool.subtract","bool.intersect","bool.exclude","bool.flatten","layout.add","layout.remove"]', `command order, got ${JSON.stringify(cmds)}`);
  assert(JSON.parse(calls[5].params).direction === 'horizontal', 'layout direction');
  api.booleanCombine([], 'union');
  api.layoutAdd([], 'vertical');
  assert(calls.length === 7, 'empty selections skipped');
});

test('styles bridge create, apply, detach, list, and delete', () => {
  const { api, calls } = adapter({
    results: {
      'style.create': '{"id":"s1"}',
      'style.apply': '{}',
      'style.detach': '{}',
      'style.list': '[{"id":"s1","name":"Brand/Primary"}]',
      'style.delete': '{}',
      'paint.documentColors': '{"colors":[{"color":"#ff0000","count":3}]}',
    },
  });
  assert(api.createStyle({ type: 'paint', name: 'Brand/Primary' }) === 's1', 'style id');
  api.applyStyle({ ids: [4], style: 's1', target: 'fill' });
  assert(JSON.parse(calls[1].params).target === 'fill', 'paint target');
  api.detachStyle({ ids: [4], which: 'fill' });
  const styles = api.listStyles('paint');
  assert(styles.length === 1 && styles[0].id === 's1', 'styles parsed');
  assert(JSON.parse(calls[3].params).type === 'paint', 'style filter');
  api.deleteStyle('s1');
  const colors = api.documentColors();
  assert(colors.length === 1 && colors[0].count === 3, 'document colors parsed');
  api.applyStyle({ style: 's1' });
  assert(!('ids' in JSON.parse(calls[calls.length - 1].params)), 'ids optional');
});

test('components bridge create, instance, swap, detach, and reset', () => {
  const { api, calls } = adapter({
    results: {
      'component.list': '[{"id":61,"name":"Button","type":"COMPONENT","page":1,"instances":2}]',
      'component.create': '{"id":61}',
      'instance.create': '{"id":62}',
      'instance.swap': '{}',
      'component.detach': '{}',
      'component.resetInstance': '{}',
    },
  });
  const comps = api.listComponents();
  assert(comps.length === 1 && comps[0].instances === 2, 'components parsed');
  assert(api.createComponent([4, 5]) === 61, 'component id');
  assert(api.createInstance({ component: 61, x: 10, y: 20 }) === 62, 'instance id');
  assert(JSON.parse(calls[2].params).component === 61, 'instance source');
  api.swapInstance([62], 61);
  api.detachInstance([62]);
  api.resetInstance([62]);
  api.detachInstance([]);
  assert(calls.length === 6, 'empty detach skipped');
});

test('prototype flows bridge add, rename, remove, and clear', () => {
  const { api, calls } = adapter({
    results: {
      'proto.flow.add': '{}', 'proto.flow.rename': '{}', 'proto.flow.remove': '{}',
      'proto.interaction.clear': '{}', 'proto.interaction.remove': '{}',
    },
  });
  api.flowAdd({ start: 7, name: 'Onboarding' });
  api.flowRename({ start: 7, name: 'Signup' });
  api.flowRemove({ start: 7 });
  api.clearInteractions([4]);
  api.removeInteraction({ id: 4, index: 0 });
  const cmds = calls.map((c) => c.cmd);
  assert(cmds[0] === 'proto.flow.add' && cmds[4] === 'proto.interaction.remove', `flow commands, got ${JSON.stringify(cmds)}`);
  assert(JSON.parse(calls[0].params).start === 7, 'flow start');
});

test('text styling bridges toggles, alignment, size, and case', () => {
  const { api, calls } = adapter({
    results: {
      'text.bold': '{}', 'text.italic': '{}', 'text.underline': '{}', 'text.strikethrough': '{}',
      'text.alignLeft': '{}', 'text.alignCenter': '{}', 'text.alignRight': '{}', 'text.alignJustify': '{}',
      'text.sizeUp': '{}', 'text.sizeDown': '{}', 'text.case': '{}',
    },
  });
  api.textToggle([4], 'bold');
  api.textToggle([4], 'italic');
  api.textToggle([4], 'underline');
  api.textToggle([4], 'strikethrough');
  api.textAlignCmd([4], 'center');
  api.textSizeStep([4], 'up');
  api.textSizeStep([4], 'down');
  api.textCase([4], 'upper');
  const cmds = calls.map((c) => c.cmd);
  assert(JSON.stringify(cmds) === '["text.bold","text.italic","text.underline","text.strikethrough","text.alignCenter","text.sizeUp","text.sizeDown","text.case"]', `text commands, got ${JSON.stringify(cmds)}`);
  assert(JSON.parse(calls[7].params).case === 'upper', 'case value');
  api.textToggle([], 'bold');
  assert(calls.length === 8, 'empty text toggle skipped');
});

test('placeImage sends base64 data and parses the placed node', () => {
  const { api, calls } = adapter({ results: { 'file.placeImage': '{"id":71,"image":"abc","width":100,"height":50}' } });
  const r = api.placeImage({ data: 'data:image/png;base64,iVBOR', x: 5, y: 6 });
  assert(r.id === 71 && r.width === 100 && r.height === 50, 'placed image parsed');
  const p = JSON.parse(calls[0].params) as Record<string, unknown>;
  assert(p.data === 'data:image/png;base64,iVBOR' && p.x === 5 && p.y === 6, 'image params');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL ENGINE ADAPTER TESTS PASSED');
