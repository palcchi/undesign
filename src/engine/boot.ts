/**
 * Boot-storage resolution. The engine snapshot in localStorage can rot
 * (truncated writes, foreign tabs, user edits); resolving it must never
 * brick the app. Storage is injected so the behavior runs under node tests
 * and in the browser alike.
 */
export interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredResolution {
  /** Snapshot bytes to load, or null to boot fresh (legacy/sample). */
  json: string | null;
  /** True when corrupt bytes were found, backed up, and cleared. */
  recovered: boolean;
  /** Backup key holding the corrupt bytes, when recovered. */
  backupKey: string | null;
}

/**
 * Structural pre-check for an engine save: JSON object with a `pages`
 * array (mirrors the File → Open detection in TopToolbar). Semantic
 * validity stays the engine's call — `load` throwing later still falls
 * back through the caller's catch path.
 */
export function isPlausibleEngineSave(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  return typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { pages?: unknown }).pages);
}

export function resolveStoredEngine(storage: MinimalStorage, key: string): StoredResolution {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { json: null, recovered: false, backupKey: null };
  }
  if (!raw) return { json: null, recovered: false, backupKey: null };
  if (isPlausibleEngineSave(raw)) return { json: raw, recovered: false, backupKey: null };
  const backupKey = `${key}.corrupt`;
  try {
    storage.setItem(backupKey, raw);
  } catch {
    // Backup best-effort; recovery proceeds regardless.
  }
  try {
    storage.removeItem(key);
  } catch {
    // Clearing best-effort; the caller boots fresh anyway.
  }
  return { json: null, recovered: true, backupKey };
}
