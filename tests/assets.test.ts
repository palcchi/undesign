/**
 * Regression tests for the image asset store (validation, sizing,
 * persistence round-trip over the in-memory fallback, pruning).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import {
  MAX_IMAGE_BYTES,
  deleteAsset,
  docImageIds,
  fitImageSize,
  getAsset,
  historyImageIds,
  layerNameFromFile,
  newAssetId,
  putAsset,
  resolveAssetDataUrl,
  unreferencedIds,
  validateImageFile,
} from '../src/assets';
import type { DesignObject, UndesignDoc } from '../src/types';

let failures = 0;
const pending: Promise<void>[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL  ${name} — ${(e as Error).message}`);
  }
}

function asyncTest(name: string, fn: () => Promise<void>): void {
  pending.push(
    fn().then(
      () => console.log(`PASS  ${name}`),
      (e) => {
        failures += 1;
        console.log(`FAIL  ${name} — ${(e as Error).message}`);
      },
    ),
  );
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function fakeObj(imageId: string | null): DesignObject {
  return { imageId } as DesignObject;
}

test('validateImageFile accepts PNG/JPEG/WebP within the size cap', () => {
  assert(validateImageFile({ name: 'a.png', type: 'image/png', size: 100 }) === null, 'png');
  assert(validateImageFile({ name: 'a.jpg', type: 'image/jpeg', size: 100 }) === null, 'jpeg');
  assert(validateImageFile({ name: 'a.webp', type: 'image/webp', size: 100 }) === null, 'webp');
  assert(
    validateImageFile({ name: 'edge.png', type: 'image/png', size: MAX_IMAGE_BYTES }) === null,
    'exactly 10 MB passes',
  );
});

test('validateImageFile rejects unsupported, empty, and oversized files', () => {
  assert(validateImageFile({ name: 'a.svg', type: 'image/svg+xml', size: 100 }) !== null, 'svg rejected');
  assert(validateImageFile({ name: 'a.gif', type: 'image/gif', size: 100 }) !== null, 'gif rejected');
  assert(validateImageFile({ name: 'a.png', type: 'image/png', size: 0 }) !== null, 'empty rejected');
  assert(
    validateImageFile({ name: 'big.png', type: 'image/png', size: MAX_IMAGE_BYTES + 1 }) !== null,
    'oversize rejected',
  );
});

test('fitImageSize scales down preserving aspect, never up', () => {
  assert(JSON.stringify(fitImageSize(2000, 1000)) === JSON.stringify({ w: 640, h: 320 }), 'landscape');
  assert(JSON.stringify(fitImageSize(1000, 2000)) === JSON.stringify({ w: 320, h: 640 }), 'portrait');
  assert(JSON.stringify(fitImageSize(100, 50)) === JSON.stringify({ w: 100, h: 50 }), 'small kept');
  assert(JSON.stringify(fitImageSize(0, 0)) === JSON.stringify({ w: 320, h: 240 }), 'invalid falls back');
});

test('newAssetId yields unique img_-prefixed ids', () => {
  const a = newAssetId();
  const b = newAssetId();
  assert(a !== b, 'unique');
  assert(a.startsWith('img_') && b.startsWith('img_'), 'prefixed');
});

test('unreferencedIds lists only orphaned candidates', () => {
  const objs = [fakeObj('keep1'), fakeObj('keep2'), fakeObj(null)];
  assert(
    JSON.stringify(unreferencedIds(objs, ['keep1', 'gone', 'keep2'])) === JSON.stringify(['gone']),
    'orphans only',
  );
  assert(unreferencedIds(objs, []).length === 0, 'empty candidates');
});

asyncTest('asset round-trip: put, resolve to data URL, delete', async () => {
  const id = `t_${Date.now().toString(36)}_rt`;
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
  await putAsset(id, blob);
  const back = await getAsset(id);
  assert(back !== null && back.size === 4, 'blob stored and fetched');
  const url = await resolveAssetDataUrl(id);
  assert(url !== null && url.startsWith('data:image/png;base64,'), `data URL resolved (got ${url?.slice(0, 30)})`);
  // Second resolve hits the session cache with the identical URL.
  assert((await resolveAssetDataUrl(id)) === url, 'cache hit stable');
  await deleteAsset(id);
  assert((await getAsset(id)) === null, 'deleted blob gone');
  assert((await resolveAssetDataUrl(id)) === null, 'deleted URL gone');
});

asyncTest('resolving an unknown asset returns null', async () => {
  assert((await resolveAssetDataUrl('t_nope_missing')) === null, 'missing id');
});

test('layerNameFromFile strips extensions and falls back cleanly', () => {
  assert(layerNameFromFile('hero-shot.png', 1) === 'hero-shot', 'extension stripped');
  assert(layerNameFromFile('a'.repeat(50) + '.jpg', 2).length === 40, 'capped at 40');
  assert(layerNameFromFile('.png', 3) === 'Image 3', 'empty base falls back');
});

function docWith(ids: (string | null)[]): UndesignDoc {
  return {
    version: 1,
    name: 't',
    pages: [{ id: 'p', name: 'p', objects: ids.map((imageId) => ({ imageId }) as DesignObject) }],
    activePageId: 'p',
    components: [],
    colorStyles: [],
    prototypeLinks: [],
  };
}

test('historyImageIds unions references across states for undo-safe pruning', () => {
  const live = historyImageIds([docWith(['a', null]), docWith(['b']), docWith([])]);
  assert(live.has('a') && live.has('b') && live.size === 2, 'union collected');
  assert(docImageIds(docWith(['a', null])).length === 1, 'single doc scan');
});

await Promise.all(pending);
if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL ASSETS TESTS PASSED');
