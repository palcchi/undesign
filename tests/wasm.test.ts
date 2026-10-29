/**
 * Regression tests for the WASM engine loader (src/wasm/engine.ts).
 * The real wasm-pack glue may not exist when unit tests run, so these tests
 * inject fake importers; the Rust suite (npm run test:rust) covers the engine
 * itself. Run with `npm test`.
 */
import { EngineLoadError, loadWasmEngine, parseUndoDepth } from '../src/wasm/engine';

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

async function atest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL  ${name} — ${(e as Error).message}`);
  }
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function fakeGlue(over: { init?: () => Promise<void>; make?: () => unknown } = {}): {
  mod: { default: () => Promise<void>; WasmEngine: new () => unknown };
  calls: string[];
} {
  const calls: string[] = [];
  class FakeEngine {
    execute(cmd: string, params: string): string {
      calls.push(`execute:${cmd}:${params}`);
      return '{"id":7}';
    }
    undo(): boolean {
      calls.push('undo');
      return true;
    }
    redo(): boolean {
      calls.push('redo');
      return false;
    }
    undoDepth(): string {
      return '1,0';
    }
    selection(): string {
      return '[7]';
    }
    setSelection(ids: string): void {
      calls.push(`select:${ids}`);
    }
    docInfo(): string {
      return '{"name":"Untitled","nodes":2,"pages":1}';
    }
    exportPageSvg(): string {
      return '<svg></svg>';
    }
    save(): string {
      return '{"doc":true}';
    }
    load(json: string): void {
      calls.push(`load:${json.length}`);
    }
  }
  return {
    mod: {
      default: over.init ?? (async () => {}),
      WasmEngine: (over.make ? (over.make() as new () => unknown) : FakeEngine) as new () => unknown,
    },
    calls,
  };
}

test('parseUndoDepth parses "u,r" and degrades garbage to [0, 0]', () => {
  assert(JSON.stringify(parseUndoDepth('3,1')) === '[3,1]', 'normal');
  assert(JSON.stringify(parseUndoDepth('0,0')) === '[0,0]', 'zeros');
  assert(JSON.stringify(parseUndoDepth('x')) === '[0,0]', 'garbage');
  assert(JSON.stringify(parseUndoDepth('')) === '[0,0]', 'empty');
  assert(JSON.stringify(parseUndoDepth('-1,2')) === '[0,2]', 'negative clamps');
  assert(JSON.stringify(parseUndoDepth('2,')) === '[2,0]', 'missing redo');
});

await atest('a rejecting importer becomes an EngineLoadError', async () => {
  try {
    await loadWasmEngine(async () => {
      throw new Error('failed to fetch');
    });
    throw new Error('should have thrown');
  } catch (e) {
    assert(e instanceof EngineLoadError, 'typed error');
    assert((e as Error).message.includes('build:wasm'), 'actionable hint');
  }
});

await atest('a failing init becomes an EngineLoadError', async () => {
  const { mod } = fakeGlue({
    init: async () => {
      throw new Error('bad magic number');
    },
  });
  try {
    await loadWasmEngine(async () => mod);
    throw new Error('should have thrown');
  } catch (e) {
    assert(e instanceof EngineLoadError, 'typed error');
    assert((e as Error).message.includes('start the engine'), 'names the stage');
  }
});

await atest('a working module yields a callable engine handle', async () => {
  const { mod, calls } = fakeGlue();
  const { engine } = await loadWasmEngine(async () => mod);
  const out = engine.execute('shape.rectangle', '{"x":1}');
  assert(out === '{"id":7}', 'execute returns result JSON');
  assert(engine.undo() === true, 'undo');
  assert(engine.redo() === false, 'redo');
  engine.setSelection('[7]');
  assert(engine.selection() === '[7]', 'selection');
  assert(engine.exportPageSvg() === '<svg></svg>', 'svg');
  assert(engine.save() === '{"doc":true}', 'save');
  engine.load('{}');
  assert(
    calls.join('|') === 'execute:shape.rectangle:{"x":1}|undo|redo|select:[7]|load:2',
    `calls recorded in order, got ${calls.join('|')}`,
  );
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL WASM LOADER TESTS PASSED');
