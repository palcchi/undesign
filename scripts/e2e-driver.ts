/**
 * Real-engine E2E driver (bundled by scripts/e2e-engine.mjs, NOT part of
 * `npm test`): runs the actual converter, readback, and adapter against the
 * actual built WASM module in node. Asserts the full migration triangle:
 * UND → engine commands → engine state → UND readback.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import initGlue, { WasmEngine } from '../src/wasm/pkg/undesign_wasm.js';
import { EngineAdapter } from '../src/engine/adapter';
import { convertUndesignToEngine } from '../src/engine/convert';
import { readEngineSnapshot } from '../src/engine/readback';
import { validateDoc } from '../src/storage';
import type { DesignObject, UndesignDoc } from '../src/types';

const ROOT = process.env.UNDESIGN_ROOT ?? process.cwd();
let failures = 0;

function check(cond: boolean, msg: string): void {
  if (cond) console.log(`PASS  ${msg}`);
  else {
    failures += 1;
    console.log(`FAIL  ${msg}`);
  }
}

function approx(a: number, b: number, eps = 0.05): boolean {
  return Math.abs(a - b) <= eps;
}

let seq = 0;
function obj(over: Partial<DesignObject> = {}): DesignObject {
  seq += 1;
  return {
    id: `u${seq}`, type: 'rectangle', name: `r${seq}`, parentId: null,
    x: 0, y: 0, w: 100, h: 60, rotation: 0, visible: true, locked: false, opacity: 1,
    fill: '#CCCCCC', fillOpacity: 1, fillGradient: null,
    fillStyleId: null, textStyleId: null, shadow: null, effectStyleId: null,
    constraints: null, layout: null, sizing: null,
    stroke: '', strokeWidth: 0, cornerRadius: 0, cornerRadii: null, clip: false,
    componentId: null, sourceId: null, componentSnapshot: null, variant: null, exposedValues: null,
    imageId: null, imageName: '', naturalW: 0, naturalH: 0,
    text: '', fontFamily: 'sans', fontSize: 16, fontWeight: 400, textAlign: 'left', lineHeight: 1.4,
    ...over,
  } as DesignObject;
}

await initGlue(await readFile(join(ROOT, 'src', 'wasm', 'pkg', 'undesign_wasm_bg.wasm')));
const api = new EngineAdapter(new WasmEngine());

// ---- 1. Convert a rich UND document through the real adapter ----
const frame = obj({ id: 'f', type: 'frame', name: 'Card', x: 10, y: 20, w: 300, h: 200, fill: '#FFFFFF' });
const chip = obj({ id: 'c', name: 'Chip', parentId: 'f', x: 16, y: 12, w: 80, h: 32, fill: '#FF4D00', cornerRadius: 8 });
const head = obj({ id: 't', type: 'text', parentId: 'f', name: 'Head', x: 16, y: 60, text: 'Hello', fontSize: 24, fontWeight: 700, textAlign: 'center' });
const dot = obj({ id: 'e', type: 'ellipse', parentId: 'f', x: 16, y: 110, w: 40, h: 40, fill: '#00FF00' });
const diag = obj({ id: 'l', type: 'line', parentId: 'f', x: 0, y: 160, w: 200, h: 30, stroke: '#000000', strokeWidth: 2 });
const rot = obj({ id: 'r', name: 'Tilt', parentId: 'f', x: 200, y: 12, w: 60, h: 20, rotation: 30, fill: '#0000FF' });
const pic = obj({ id: 'p', type: 'image', parentId: 'f', name: 'Photo', x: 200, y: 60, w: 60, h: 40, imageId: 'a1' });
const und: UndesignDoc = {
  version: 1, name: 'e2e', activePageId: 'p1',
  pages: [{ id: 'p1', name: 'Home', objects: [frame, chip, head, dot, diag, rot, pic] }],
  components: [], variantSets: [], colorStyles: [], textStyles: [], effectStyles: [], prototypeLinks: [],
};
const res = convertUndesignToEngine(und, { execute: (cmd, params) => api.cmd(cmd, params) });
check(res.objects === 7 && res.skipped === 0, `converted 7 objects (${res.objects} ok, ${res.skipped} skipped)`);
check(res.warnings.some((w) => w.scope === 'p' && w.property === 'imageId'), 'image substitution recorded');

// ---- 2. Engine state matches the source ----
const tree = api.describePage(32);
check(tree.children.length === 1 && tree.children[0].name === 'Card', 'frame at page root');
const kids = tree.children[0].children;
check(kids.length === 6, `all children converted (${kids.length})`);
const chipNode = kids.find((k) => k.name === 'Chip');
check(chipNode !== undefined && chipNode.fills[0]?.color === '#FF4D00', 'chip fill preserved');
check(chipNode !== undefined && chipNode.cornerRadius === 8, 'chip corners preserved');
const headNode = kids.find((k) => k.name === 'Head');
check(headNode !== undefined && headNode.characters === 'Hello', 'text content preserved');
check(headNode !== undefined && headNode.fontSize === 24 && headNode.textAlign === 'center', 'typography preserved');
const tiltNode = kids.find((k) => k.name === 'Tilt');
check(tiltNode !== undefined && tiltNode.rotation === -30, `rotation negated at the boundary (${tiltNode?.rotation})`);
const lineNode = kids.find((k) => k.type === 'LINE');
check(lineNode !== undefined && approx(lineNode.width ?? 0, Math.hypot(200, 30)), 'line length preserved');
const svg = api.svg();
check(svg.includes('<svg') && svg.length > 500, `SVG render produced (${svg.length} bytes)`);
const hits = api.hitTest(10 + 16 + 5, 20 + 12 + 5);
check(hits.length > 0 && hits.some((h) => h.name === 'Chip'), `hit stack finds the chip (${hits.map((h) => h.name).join(',')})`);
const top = api.hitTop(10 + 16 + 5, 20 + 12 + 5);
check(top === chipNode?.id, `click resolves to the chip (top=${top}, chip=${chipNode?.id})`);
check(api.hitTop(2000, 2000) === null, 'click on empty canvas resolves to null');

// ---- 3. Read back to UND and compare the representable subset ----
const pages = api.pages();
const trees = new Map([[pages[0].id, tree]]);
const { doc: back, warnings } = readEngineSnapshot(pages, trees, 'e2e');
check(back.pages.length === 1 && back.pages[0].objects.length === 7, 'readback preserves counts');
const backChip = back.pages[0].objects.find((o) => o.name === 'Chip');
check(backChip !== undefined && backChip.fill === '#FF4D00' && backChip.cornerRadius === 8, 'chip round-trips');
check(backChip !== undefined && backChip.parentId !== null, 'hierarchy round-trips');
const backTilt = back.pages[0].objects.find((o) => o.name === 'Tilt');
check(backTilt !== undefined && approx(backTilt.rotation, 30), `rotation round-trips (${backTilt?.rotation})`);
const backHead = back.pages[0].objects.find((o) => o.name === 'Head');
check(backHead !== undefined && backHead.text === 'Hello' && backHead.fontSize === 24, 'text round-trips');
check(warnings.some((w) => w.property === 'geometry'), 'line approximation recorded');
const valid = validateDoc(JSON.parse(JSON.stringify(back)) as unknown);
check(valid !== null, 'readback output is a valid UND document');

// ---- 4. Adapter workflows on the migrated document ----
const before = api.undoDepth()[0];
api.move([chipNode!.id], 5, 5);
check(api.undoDepth()[0] === before + 1, 'move is undoable');
check(api.undo() === true && api.redo() === true, 'undo/redo round-trips');
const gid = api.group([chipNode!.id, headNode!.id]);
check(typeof gid === 'number', 'group returns an id');
api.ungroup([gid]);
const dup = api.duplicate([chipNode!.id]);
check(dup.length === 1 && dup[0] !== chipNode!.id, 'duplicate returns a new id');
api.remove(dup);
api.align([chipNode!.id, headNode!.id], 'left');
api.reparent([chipNode!.id], tree.children[0].id, 0);
const p2 = api.addPage('Second');
api.selectPage(p2);
api.renamePage(p2, 'Two');
check(api.pages().length === 2, 'second page added');
api.deletePage(p2);
check(api.pages().length === 1, 'second page deleted');
const saved = api.save();
const api2 = new EngineAdapter(new WasmEngine());
api2.load(saved);
check(api2.describePage(0).childCount === 1, 'save/load preserves the document');

if (failures > 0) {
  console.log(`${failures} e2e check(s) failed`);
  process.exit(1);
}
console.log('ENGINE E2E: ALL CHECKS PASSED');
