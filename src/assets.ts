/**
 * Local image asset store. Pixels live in IndexedDB (with an in-memory
 * fallback), keyed by asset id; documents carry only the reference so JSON
 * and localStorage stay small. A session cache holds data URLs for
 * synchronous consumers such as SVG export.
 */
import { pageToSvg, uid } from './utils';
import type { DesignObject, DocPage, UndesignDoc } from './types';

export const ASSET_DB = 'undesign.assets.v1';
export const ASSET_STORE = 'images';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_DIM = 640;
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export interface ImageFileLike {
  name: string;
  type: string;
  size: number;
}

/** Human-readable rejection reason, or null when the file is acceptable. */
export function validateImageFile(file: ImageFileLike): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return `“${file.name}” is not a supported image (PNG, JPEG, or WebP).`;
  }
  if (file.size === 0) return `“${file.name}” is empty.`;
  if (file.size > MAX_IMAGE_BYTES) {
    return `“${file.name}” is larger than 10 MB.`;
  }
  return null;
}

/** Natural size scaled to fit maxDim, preserving aspect. Never upscales. */
export function fitImageSize(nw: number, nh: number, maxDim = MAX_IMPORT_DIM): { w: number; h: number } {
  if (!Number.isFinite(nw) || !Number.isFinite(nh) || nw <= 0 || nh <= 0) {
    return { w: 320, h: 240 };
  }
  const scale = Math.min(1, maxDim / Math.max(nw, nh));
  return { w: Math.max(1, Math.round(nw * scale)), h: Math.max(1, Math.round(nh * scale)) };
}

export function newAssetId(): string {
  return uid('img');
}

/** Layer name from a filename: extension stripped, capped, with a fallback. */
export function layerNameFromFile(name: string, n: number): string {
  const base = name.replace(/\.[^.]*$/, '').trim().slice(0, 40);
  return base !== '' ? base : `Image ${n}`;
}

/** Candidates no longer referenced by any object: safe to delete. */
export function unreferencedIds(objects: DesignObject[], candidates: string[]): string[] {
  const live = new Set<string>();
  for (const o of objects) {
    if (o.imageId) live.add(o.imageId);
  }
  return candidates.filter((id) => !live.has(id));
}

/** Every asset id referenced anywhere in a document. */
export function docImageIds(doc: UndesignDoc): string[] {
  const out: string[] = [];
  for (const p of doc.pages) {
    for (const o of p.objects) {
      if (o.imageId) out.push(o.imageId);
    }
  }
  return out;
}

/**
 * Asset ids referenced by any of the given history states. Pruning consults
 * the full undo/redo stack (plus the incoming present) so undo can never
 * resurrect an object whose pixels were deleted.
 */
export function historyImageIds(states: UndesignDoc[]): Set<string> {
  const live = new Set<string>();
  for (const doc of states) {
    for (const id of docImageIds(doc)) live.add(id);
  }
  return live;
}

/** pageToSvg with the session asset cache wired as the image resolver. */
export function exportPageSvg(page: DocPage, onlyIds?: string[], opts?: { includeIds?: boolean }): string {
  return pageToSvg(page, onlyIds, (imageId) => (imageId ? cachedDataUrl(imageId) : null), opts);
}

/* ================= persistence (IndexedDB + memory fallback) ================= */

const memoryBlobs = new Map<string, Blob>();

function idb(): IDBFactory | null {
  return typeof indexedDB === 'undefined' ? null : indexedDB;
}

function openDb(): Promise<IDBDatabase | null> {
  const factory = idb();
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = factory.open(ASSET_DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(ASSET_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore(mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(ASSET_STORE, mode);
    return tx.objectStore(ASSET_STORE);
  } catch {
    return null;
  }
}

function request<T>(make: () => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const req = make();
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putAsset(id: string, blob: Blob): Promise<boolean> {
  memoryBlobs.set(id, blob);
  const store = await withStore('readwrite');
  if (!store) return true;
  await request(() => store.put(blob, id));
  return true;
}

export async function getAsset(id: string): Promise<Blob | null> {
  const mem = memoryBlobs.get(id);
  if (mem) return mem;
  const store = await withStore('readonly');
  if (!store) return null;
  const blob = await request<Blob>(() => store.get(id));
  if (blob) memoryBlobs.set(id, blob);
  return blob;
}

export async function deleteAsset(id: string): Promise<void> {
  memoryBlobs.delete(id);
  urlCache.delete(id);
  const store = await withStore('readwrite');
  if (!store) return;
  await request(() => store.delete(id));
}

/* ================= data URLs (session cache + conversion) ================= */

const urlCache = new Map<string, string>();

export function cachedDataUrl(id: string): string | null {
  return urlCache.get(id) ?? null;
}

export function evictCached(id: string): void {
  urlCache.delete(id);
}

async function blobToDataUrl(blob: Blob): Promise<string | null> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onload = () => {
          resolve(typeof reader.result === 'string' ? reader.result : null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      } catch {
        resolve(null);
      }
    });
  }
  // Non-DOM runtimes (tests): build the data URL from raw bytes.
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const b64 = typeof btoa !== 'undefined' ? btoa(bin) : '';
    if (!b64) return null;
    return `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
  } catch {
    return null;
  }
}

/** Resolve an asset id to a data URL, warming the session cache. */
export async function resolveAssetDataUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const blob = await getAsset(id);
  if (!blob) return null;
  const url = await blobToDataUrl(blob);
  if (url) urlCache.set(id, url);
  return url;
}

/* ================= image decoding (dimensions) ================= */

export interface DecodedSize {
  w: number;
  h: number;
}

export type DecodeFn = (blob: Blob) => Promise<DecodedSize | null>;

async function decodeViaBitmap(blob: Blob): Promise<DecodedSize | null> {
  if (typeof createImageBitmap === 'undefined') return null;
  try {
    const bmp = await createImageBitmap(blob);
    const size = { w: bmp.width, h: bmp.height };
    bmp.close();
    return size.w > 0 && size.h > 0 ? size : null;
  } catch {
    return null;
  }
}

async function decodeViaElement(blob: Blob): Promise<DecodedSize | null> {
  if (typeof Image === 'undefined' || typeof URL === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

/** Intrinsic pixel size of an image blob; decode is injectable for tests. */
export async function decodeImageSize(blob: Blob, decode?: DecodeFn): Promise<DecodedSize | null> {
  if (decode) return decode(blob);
  return (await decodeViaBitmap(blob)) ?? (await decodeViaElement(blob));
}
