/**
 * Regression tests for keyboard shortcut suppression rules.
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { isFormTarget } from '../src/utils';

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

test('text-entry targets suppress global shortcuts', () => {
  assert(isFormTarget('INPUT', false), 'input');
  assert(isFormTarget('TEXTAREA', false), 'textarea');
  assert(isFormTarget('SELECT', false), 'select (native type-ahead + arrows)');
  assert(isFormTarget('textarea', false), 'case-insensitive');
  assert(isFormTarget('DIV', true), 'contentEditable');
});

test('canvas and chrome targets keep shortcuts active', () => {
  assert(!isFormTarget('BUTTON', false), 'buttons have no letter-key behavior');
  assert(!isFormTarget('DIV', false), 'plain div');
  assert(!isFormTarget('svg', false), 'svg root');
  assert(!isFormTarget('rect', false), 'svg shape');
  assert(!isFormTarget(undefined, false), 'missing target');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL KEYBOARD TESTS PASSED');
