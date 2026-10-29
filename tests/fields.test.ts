/**
 * Regression tests for property-field commit decisions (history granularity).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { resolveHexCommit, resolveNumericCommit } from '../src/utils';

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

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${msg} (got ${a}, want ${b})`);
}

test('numeric commit parses, clamps, and skips no-ops', () => {
  assertEq(resolveNumericCommit('12.5', 0), { action: 'commit', value: 12.5 }, 'parse');
  assertEq(resolveNumericCommit(' 7 ', 0), { action: 'commit', value: 7 }, 'trims');
  assertEq(resolveNumericCommit('abc', 0), { action: 'noop' }, 'invalid text');
  assertEq(resolveNumericCommit('', 0), { action: 'noop' }, 'empty text');
  assertEq(resolveNumericCommit('3', 0, 5), { action: 'commit', value: 5 }, 'min clamp');
  assertEq(resolveNumericCommit('99', 0, undefined, 10), { action: 'commit', value: 10 }, 'max clamp');
  assertEq(resolveNumericCommit('12', 12), { action: 'noop' }, 'unchanged value');
  assertEq(resolveNumericCommit('12.0', 12), { action: 'noop' }, 'numeric equality');
});

test('hex commit normalizes, clears, and skips no-ops', () => {
  assertEq(resolveHexCommit('', '#FFFFFF'), { action: 'clear' }, 'empty clears');
  assertEq(resolveHexCommit('', ''), { action: 'noop' }, 'already none');
  assertEq(resolveHexCommit('#abc', ''), { action: 'commit', value: '#AABBCC' }, 'short hex');
  assertEq(resolveHexCommit('#aabbcc', ''), { action: 'commit', value: '#AABBCC' }, 'case');
  assertEq(resolveHexCommit('#AABBCC', '#AABBCC'), { action: 'noop' }, 'unchanged value');
  assertEq(resolveHexCommit('red', ''), { action: 'noop' }, 'named color rejected');
  assertEq(resolveHexCommit('#12', ''), { action: 'noop' }, 'malformed hex');
  assertEq(resolveHexCommit('  #abc  ', ''), { action: 'commit', value: '#AABBCC' }, 'trims');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL FIELDS TESTS PASSED');
