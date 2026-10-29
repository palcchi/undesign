/**
 * Boot recovery tests: a corrupt engine snapshot in storage must never brick
 * the app. Resolution backs the corrupt bytes up under `<key>.corrupt`,
 * clears the bad key, and reports recovery so the caller falls through to
 * legacy/sample boot. Storage is injected (a Map fake here) so node runs it.
 * Run with `npm test`.
 */
import { resolveStoredEngine, type MinimalStorage } from '../src/engine/boot';

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

function fakeStorage(entries: Record<string, string> = {}): MinimalStorage & { dump: () => Record<string, string> } {
  const map = new Map<string, string>(Object.entries(entries));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    dump: () => Object.fromEntries(map),
  };
}

const KEY = 'undesign.engine.v1';
const ENGINE_SAVE = '{"pages":[7],"current":7}';

test('absent key resolves to fresh boot without recovery', () => {
  const s = fakeStorage();
  const r = resolveStoredEngine(s, KEY);
  assert(r.json === null && r.recovered === false && r.backupKey === null, 'fresh boot');
  assert(Object.keys(s.dump()).length === 0, 'storage untouched');
});

test('plausible engine save passes through untouched', () => {
  const s = fakeStorage({ [KEY]: ENGINE_SAVE });
  const r = resolveStoredEngine(s, KEY);
  assert(r.json === ENGINE_SAVE && r.recovered === false, 'passes through');
  assert(s.dump()[KEY] === ENGINE_SAVE, 'key untouched');
  assert(!(`${KEY}.corrupt` in s.dump()), 'no backup written');
});

test('garbage bytes are backed up, cleared, and reported', () => {
  const s = fakeStorage({ [KEY]: '{oops' });
  const r = resolveStoredEngine(s, KEY);
  assert(r.json === null && r.recovered === true, 'recovered');
  assert(r.backupKey === `${KEY}.corrupt`, 'backup key named');
  assert(!(KEY in s.dump()), 'bad key cleared');
  assert(s.dump()[`${KEY}.corrupt`] === '{oops', 'bytes preserved in backup');
});

test('valid JSON with the wrong shape is treated as corrupt', () => {
  for (const bad of ['null', '[]', '"str"', '{"pages":{}}', '{"noPages":true}']) {
    const s = fakeStorage({ [KEY]: bad });
    const r = resolveStoredEngine(s, KEY);
    assert(r.json === null && r.recovered === true, `recovered for ${bad}`);
    assert(s.dump()[`${KEY}.corrupt`] === bad, `backup for ${bad}`);
  }
});

test('truncated engine save is treated as corrupt', () => {
  const s = fakeStorage({ [KEY]: '{"pages":[7' });
  const r = resolveStoredEngine(s, KEY);
  assert(r.json === null && r.recovered === true, 'recovered');
});

test('throwing storage degrades to fresh boot', () => {
  const throwing: MinimalStorage = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  };
  const r = resolveStoredEngine(throwing, KEY);
  assert(r.json === null && r.recovered === false && r.backupKey === null, 'safe nulls');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL BOOT TESTS PASSED');
