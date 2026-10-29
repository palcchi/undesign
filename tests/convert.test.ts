/**
 * Converter tests: UND→FC emission is asserted call-by-call against a
 * recording fake, mirroring the engine commands proven by `cargo test`
 * (`migration_script_builds_a_full_page`); the readback half runs over a
 * real captured engine snapshot in tests/fixtures/engine-tree.json.
 * Run with `npm test`.
 */
import { convertUndesignToEngine, type ConvertApi } from '../src/engine/convert';
import { readEngineSnapshot } from '../src/engine/readback';
import { parseEngineNode, parseEnginePages } from '../src/engine/adapter';
import { validateDoc } from '../src/storage';
import type { DesignObject, UndesignDoc } from '../src/types';
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

let seq = 0;
function obj(over: Partial<DesignObject> = {}): DesignObject {
  seq += 1;
  return {
    id: `u${seq}`,
    type: 'rectangle',
    name: `r${seq}`,
    parentId: null,
    x: 0, y: 0, w: 100, h: 60,
    rotation: 0,
    visible: true, locked: false, opacity: 1,
    fill: '#CCCCCC', fillOpacity: 1, fillGradient: null,
    fillStyleId: null, textStyleId: null, shadow: null, effectStyleId: null,
    constraints: null, layout: null, sizing: null,
    stroke: '', strokeWidth: 0,
    cornerRadius: 0, cornerRadii: null, clip: false,
    componentId: null, sourceId: null, componentSnapshot: null, variant: null,
    exposedValues: null,
    imageId: null, imageName: '', naturalW: 0, naturalH: 0,
    text: '', fontFamily: 'sans', fontSize: 16, fontWeight: 400,
    textAlign: 'left', lineHeight: 1.4,
    ...over,
  } as DesignObject;
}

function doc(pages: UndesignDoc['pages']): UndesignDoc {
  return {
    version: 1, name: 'conv', pages, activePageId: pages[0].id,
    components: [], variantSets: [], colorStyles: [], textStyles: [],
    effectStyles: [], prototypeLinks: [],
  };
}

interface Call {
  cmd: string;
  params: Record<string, unknown>;
}

function recordingApi(): { api: ConvertApi; calls: Call[] } {
  const calls: Call[] = [];
  let next = 100;
  const api: ConvertApi = {
    execute(cmd: string, params: Record<string, unknown>): unknown {
      calls.push({ cmd, params });
      if (cmd === 'page.list') return [{ id: 1, name: 'Page 1', current: true, children: 0 }];
      if (cmd === 'page.add') return { id: 2 };
      if (cmd === 'shape.rectangle' || cmd === 'shape.ellipse' || cmd === 'shape.line' || cmd === 'node.create' || cmd === 'text.create') {
        next += 1;
        return { id: next };
      }
      return {};
    },
  };
  return { api, calls };
}

function byCmd(calls: Call[], cmd: string): Call[] {
  return calls.filter((c) => c.cmd === cmd);
}

test('conversion emits pages, creates, and prop sets in order', () => {
  const frame = obj({ id: 'f', type: 'frame', name: 'Card', x: 10, y: 20, w: 300, h: 200, fill: '#FFFFFF' });
  const kid = obj({ id: 'k', name: 'Chip', parentId: 'f', x: 16, y: 12, w: 80, h: 32, fill: '#FF0000' });
  const { api, calls } = recordingApi();
  const res = convertUndesignToEngine(doc([{ id: 'p', name: 'Home', objects: [kid, frame] }]), api);
  assert(res.pages === 1 && res.objects === 2 && res.skipped === 0, 'counts');
  assert(res.warnings.length === 0, `no warnings, got ${JSON.stringify(res.warnings)}`);
  // First page is renamed in place, never re-added.
  assert(byCmd(calls, 'page.add').length === 0, 'no page.add for the first page');
  const rename = byCmd(calls, 'page.rename')[0];
  assert(rename.params.id === 1 && rename.params.name === 'Home', 'first page renamed');
  // Parent-first creation despite array order.
  const creates = calls.filter((c) => c.cmd === 'node.create' || c.cmd.startsWith('shape.'));
  assert(creates.length === 2, 'two creates');
  assert(creates[0].cmd === 'node.create' && (creates[0].params as { type: string }).type === 'frame', 'frame first');
  assert(creates[1].params.parent === 101, 'child links the frame engine id');
  const sets = byCmd(calls, 'node.set');
  assert(sets.length === 2, 'one prop set per object');
  const chipProps = (sets[1].params as { props: Record<string, unknown> }).props;
  assert(chipProps.name === 'Chip' && (chipProps as { fill: string }).fill === '#FF0000', 'chip props');
  // Ends back on the first page.
  const selects = byCmd(calls, 'page.select');
  assert(selects.length === 2 && selects[1].params.id === 1, 'reselects the first page');
});

test('second pages are added and selected', () => {
  const { api, calls } = recordingApi();
  convertUndesignToEngine(
    doc([
      { id: 'p1', name: 'A', objects: [] },
      { id: 'p2', name: 'B', objects: [obj({ id: 'r' })] },
    ]),
    api,
  );
  const added = byCmd(calls, 'page.add');
  assert(added.length === 1 && added[0].params.name === 'B', 'second page added');
  const selects = byCmd(calls, 'page.select').map((c) => c.params.id);
  assert(JSON.stringify(selects) === '[1,2,1]', `select order, got ${JSON.stringify(selects)}`);
});

test('text, lines, and images map with explicit fallbacks', () => {
  const t = obj({ id: 't', type: 'text', text: 'Hi', fontSize: 24, fontWeight: 700, textAlign: 'center', lineHeight: 2 });
  const ln = obj({ id: 'ln', type: 'line', x: 10, y: 20, w: 100, h: 60, stroke: '#111111', strokeWidth: 2 });
  const img = obj({ id: 'im', type: 'image', name: 'Photo', imageId: 'a1', imageName: 'a.png' });
  const { api, calls } = recordingApi();
  const res = convertUndesignToEngine(doc([{ id: 'p', name: 'P', objects: [t, ln, img] }]), api);
  const tc = byCmd(calls, 'text.create')[0];
  assert(tc.params.text === 'Hi', 'characters passed');
  const tset = byCmd(calls, 'node.set')[0].params as { props: Record<string, unknown> };
  assert(tset.props.fontSize === 24 && tset.props.fontWeight === 700, 'type props');
  assert(tset.props.textAlign === 'center' && tset.props.lineHeight === '200%', 'align and leading');
  const lc = byCmd(calls, 'shape.line')[0].params as { x: number; y: number; width: number; props: { rotation: number } };
  const len = Math.hypot(100, 60);
  assert(approx(lc.width, len), 'line length');
  assert(approx(lc.x, 60 - len / 2) && approx(lc.y, 50), `centered placement, got ${lc.x},${lc.y}`);
  assert(approx(lc.props.rotation, -((Math.atan2(60, 100) * 180) / Math.PI)), 'folded angle (negated: engine is ccw-positive)');
  const imgWarn = res.warnings.find((w) => w.scope === 'im');
  assert(imgWarn !== undefined && imgWarn.property === 'imageId', 'image recorded');
  const placeholderName = byCmd(calls, 'node.set').some(
    (s) => ((s.params as { props: { name?: unknown } }).props.name as string).includes('image not migrated'),
  );
  assert(placeholderName, 'image placeholder is honestly named');
  const placeholderRect = byCmd(calls, 'shape.rectangle').find((c) => c.params.width === 100);
  assert(placeholderRect !== undefined, 'image placeholder keeps geometry');
});

test('rotation flips sign at the boundary (UND cw, engine ccw)', () => {
  const o = obj({ id: 'r', rotation: 45 });
  const { api, calls } = recordingApi();
  convertUndesignToEngine(doc([{ id: 'p', name: 'P', objects: [o] }]), api);
  const set = byCmd(calls, 'node.set')[0].params as { props: { rotation: number } };
  assert(set.props.rotation === -45, `negated, got ${set.props.rotation}`);
});

test('strokes use singular keys and translucent fills are typed', () => {
  const o = obj({ id: 's', stroke: '#111111', strokeWidth: 2, fill: '#222222', fillOpacity: 0.5 });
  const { api, calls } = recordingApi();
  convertUndesignToEngine(doc([{ id: 'p', name: 'P', objects: [o] }]), api);
  const set = byCmd(calls, 'node.set')[0].params as { props: Record<string, unknown> };
  assert(set.props.stroke === '#111111' && set.props.strokeWeight === 2, `singular stroke, got ${JSON.stringify(set.props)}`);
  assert(
    JSON.stringify(set.props.fills) === '[{"type":"solid","color":"#222222","opacity":0.5}]',
    `typed translucent fill, got ${JSON.stringify(set.props.fills)}`,
  );
  const plain = obj({ id: 'q', stroke: '', fill: '' });
  const { api: api2, calls: calls2 } = recordingApi();
  convertUndesignToEngine(doc([{ id: 'p', name: 'P', objects: [plain] }]), api2);
  const set2 = byCmd(calls2, 'node.set')[0].params as { props: Record<string, unknown> };
  assert(JSON.stringify(set2.props.strokes) === '[]' && JSON.stringify(set2.props.fills) === '[]', 'empty lists clear paints');
});

test('styling layers warn instead of silently dropping', () => {
  const o = obj({
    id: 's', fillGradient: { angle: 90, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#FFF' }] },
    fillStyleId: 'cs1', shadow: { offsetX: 0, offsetY: 4, blur: 8, spread: 0, color: '#000', opacity: 0.5 },
    layout: { direction: 'horizontal', gap: 8, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, alignMain: 'start', alignCross: 'start' },
    componentId: 'c1',
  });
  const d = doc([{ id: 'p', name: 'P', objects: [o] }]);
  d.components = [{ id: 'c1', name: 'C', pageId: 'p', rootId: 's', exposed: {} }];
  d.prototypeLinks = [{ id: 'l', sourceId: 's', targetFrameId: 'f' }];
  const { api } = recordingApi();
  const res = convertUndesignToEngine(d, api);
  const props = new Set(res.warnings.map((w) => w.property));
  for (const p of ['fillGradient', 'fillStyleId', 'shadow', 'layout', 'componentId', 'components', 'prototypeLinks']) {
    assert(props.has(p), `warns on ${p}`);
  }
});

test('frame layout, sizing, and constraints migrate to engine keys', () => {
  const frame = obj({
    id: 'f', type: 'frame',
    layout: { direction: 'horizontal', gap: 8, paddingTop: 4, paddingRight: 6, paddingBottom: 4, paddingLeft: 6, alignMain: 'space-between', alignCross: 'center' },
    sizing: { h: 'hug', v: 'fixed', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
  });
  const kid = obj({
    id: 'k', parentId: 'f',
    sizing: { h: 'fill', v: 'fixed', minW: 10, maxW: null, minH: null, maxH: 200, absolute: false },
    constraints: { horizontal: 'stretch', vertical: 'middle' },
  });
  const { api, calls } = recordingApi();
  const res = convertUndesignToEngine(doc([{ id: 'p', name: 'P', objects: [frame, kid] }]), api);
  assert(!res.warnings.some((w) => w.property === 'layout' || w.property === 'sizing' || w.property === 'constraints'), 'no layout warnings');
  const sets = byCmd(calls, 'node.set').map((c) => c.params as { props: Record<string, unknown> });
  const fp = sets[0].props;
  assert(fp.layout === 'horizontal', `layout mode, got ${fp.layout}`);
  assert(fp.gap === 8 && fp.paddingRight === 6, 'gap and padding');
  assert(fp.mainAlign === 'spaceBetween' && fp.crossAlign === 'center', `alignment mapping, got ${fp.mainAlign}/${fp.crossAlign}`);
  assert(fp.sizingH === 'hug', 'layout frames can hug');
  const kp = sets[1].props;
  assert(kp.sizingH === 'fill' && kp.sizingV === 'fixed', 'fill under a layout parent migrates');
  assert(kp.minWidth === 10 && kp.maxHeight === 200 && !('maxWidth' in kp), 'min/max clamps, nulls skipped');
  assert(JSON.stringify(kp.constraints) === '{"horizontal":"leftRight","vertical":"center"}', `constraint mapping, got ${JSON.stringify(kp.constraints)}`);
});

test('sizing the engine refuses warns instead of failing the import', () => {
  const plain = obj({ id: 'g', type: 'frame' });
  const kid = obj({
    id: 'k', parentId: 'g',
    sizing: { h: 'fill', v: 'hug', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
  });
  const { api, calls } = recordingApi();
  const res = convertUndesignToEngine(doc([{ id: 'p', name: 'P', objects: [plain, kid] }]), api);
  const skips = res.warnings.filter((w) => w.property === 'sizing');
  assert(skips.length === 2, `both refused modes recorded, got ${skips.length}`);
  const kp = (byCmd(calls, 'node.set')[1].params as { props: Record<string, unknown> }).props;
  assert(!('sizingH' in kp) && !('sizingV' in kp), 'refused modes withheld from node.set');
});

test('dangling parents, cycles, and zero-length lines degrade safely', () => {
  const dangling = obj({ id: 'd', parentId: 'ghost' });
  const a = obj({ id: 'a', parentId: 'b' });
  const b = obj({ id: 'b', parentId: 'a' });
  const zero = obj({ id: 'z', type: 'line', x: 5, y: 5, w: 0, h: 0 });
  const { api, calls } = recordingApi();
  const res = convertUndesignToEngine(doc([{ id: 'p', name: 'P', objects: [dangling, a, b, zero] }]), api);
  assert(res.skipped === 1, 'zero-length line skipped');
  assert(res.warnings.some((w) => w.scope === 'z'), 'line skip recorded');
  assert(res.warnings.some((w) => w.scope === 'd' && w.property === 'parentId'), 'dangling recorded');
  assert(res.warnings.some((w) => w.property === 'parentId' && w.detail.includes('cyclic')), 'cycle recorded');
  const creates = calls.filter((c) => c.cmd.startsWith('shape.') || c.cmd === 'node.create');
  assert(creates.length === 3, 'three objects created');
  // The dangling object and the cycle-breaker land at root; the second
  // cycle member nests under the breaker (cycle resolved by ordering).
  assert(!('parent' in (creates[0].params as object)), 'dangling lands at root');
  assert(!('parent' in (creates[1].params as object)), 'cycle-breaker lands at root');
  assert((creates[2].params as { parent: number }).parent === 102, 'cycle member nests under the breaker');
});

test('readback rebuilds a loadable UND doc from a real engine snapshot', () => {
  const snap = snapshotJson as { pages: unknown; trees: Record<string, unknown>; docName: string };
  const pages = parseEnginePages(snap.pages);
  const trees = new Map<number, ReturnType<typeof parseEngineNode>>();
  for (const [k, v] of Object.entries(snap.trees)) trees.set(Number(k), parseEngineNode(v));
  const { doc: out, warnings } = readEngineSnapshot(pages, trees, snap.docName);
  assert(out.pages.length === pages.length, 'page count preserved');
  const names = out.pages.flatMap((p) => p.objects.map((o) => o.name));
  assert(names.includes('Card') && names.includes('Chip'), `names kept, got ${names.join(',')}`);
  const chip = out.pages[0].objects.find((o) => o.name === 'Chip');
  assert(chip !== undefined && chip.fill === '#00FF00', 'fill read back');
  assert(chip !== undefined && chip.cornerRadius === 8, 'corners read back');
  assert(chip !== undefined && chip.parentId !== null, 'hierarchy read back');
  const txt = out.pages[0].objects.find((o) => o.type === 'text');
  assert(txt !== undefined && txt.text === 'Hello!' && txt.fontSize === 20, 'text read back');
  assert(
    warnings.some((w) => w.property === 'type'),
    `skipped engine types recorded, got ${JSON.stringify(warnings)}`,
  );
  const valid = validateDoc(JSON.parse(JSON.stringify(out)) as unknown);
  assert(valid !== null && valid.pages.length === out.pages.length, 'readback output validates as UND');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL CONVERTER TESTS PASSED');
