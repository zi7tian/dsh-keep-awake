import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNativeManager } from '../native/manager.js';
import { acquireWindows, acquireMac } from '../native/adapters.js';

function harness() {
  const children = [], timers = new Map(); let id = 0;
  const manager = createNativeManager({
    schedule(callback, delay) { const key = ++id; timers.set(key, { callback, delay }); return key; },
    unschedule(key) { timers.delete(key); },
    spawnProcess(executable, args, options) {
      assert.equal(options.shell, false); assert.ok(args[0].endsWith('worker.js'));
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdin = new EventEmitter();
      child.ended = false; child.killed = false;
      child.stdin.end = () => { child.ended = true; };
      child.kill = () => { child.killed = true; };
      children.push(child); return child;
    },
  });
  const ready = (child, value = {}) => child.stdout.emit('data', JSON.stringify({ kind: 'ready', backend: 'fake', display: true, sleep: true, ...value }) + '\n');
  return { manager, children, timers, ready };
}
test('native lock covers concurrent tasks; ending last task closes pipe', () => {
  const h = harness(); h.manager.update(2); h.ready(h.children[0]);
  assert.equal('kind' in h.manager.snapshot(), false);
  assert.equal(h.manager.snapshot().status, 'active'); h.manager.update(1);
  assert.equal(h.children.length, 1); assert.equal(h.children[0].ended, false);
  h.manager.update(0); assert.equal(h.children[0].ended, true);
  h.children[0].emit('exit', 0); assert.equal(h.timers.size, 0);
  assert.equal(h.manager.snapshot().status, 'idle'); h.manager.dispose();
});
test('stale ready/exit after stop cannot activate or restart a helper', () => {
  const h = harness(); h.manager.update(1); h.manager.update(0);
  h.ready(h.children[0]); h.children[0].emit('exit', 0);
  assert.equal(h.manager.snapshot().status, 'idle'); assert.equal(h.timers.size, 0); h.manager.dispose();
});
test('crash backs off, partial results are honest, disable cancels retries', () => {
  const h = harness(); h.manager.update(1); h.ready(h.children[0], { display: false });
  assert.equal(h.manager.snapshot().status, 'partial');
  h.children[0].emit('exit', 1); assert.equal(h.manager.snapshot().status, 'error');
  const retry = [...h.timers].find(([, value]) => value.delay === 1000);
  h.timers.delete(retry[0]); retry[1].callback(); assert.equal(h.children.length, 2);
  h.manager.setEnabled(false); assert.equal(h.children[1].ended, true);
  h.children[1].emit('exit', 0); h.manager.dispose();
});
test('startup timeout terminates stuck helper; unload cannot reacquire', () => {
  const h = harness(); h.manager.update(1);
  const startup = [...h.timers].find(([, value]) => value.delay === 15000);
  h.timers.delete(startup[0]); startup[1].callback(); assert.equal(h.children[0].ended, true);
  h.manager.dispose(); h.ready(h.children[0]); h.children[0].emit('exit', 1);
  assert.equal(h.timers.size, 0); assert.equal(h.manager.snapshot().status, 'disabled');
});

function fakeKoffi(functions) {
  return { load: () => ({ func: (...args) => {
    const name = args.length > 1 ? args[1] : args[0].match(/(\w+)\(/)[1];
    assert.ok(functions[name], name); return functions[name];
  } }), Union: class {}, struct: value => value, union: value => value, pointer: value => value, sizeof: () => 8, address: () => 123n };
}
test('Windows power request tracks display/system separately and releases on partial failure', () => {
  const actions = [];
  const k = fakeKoffi({ PowerCreateRequest: context => { assert.equal(context.Flags, 1); return {}; },
    PowerSetRequest: (_, type) => { actions.push(['set', type]); return type === 0; },
    PowerClearRequest: (_, type) => actions.push(['clear', type]), CloseHandle: () => actions.push(['close']),
  });
  assert.throws(() => acquireWindows(k), /PowerSetRequest/);
  assert.deepEqual(actions, [['set', 0], ['set', 1], ['clear', 0], ['close']]);
});
test('macOS releases prior assertion when second assertion fails', () => {
  const released = [], freed = []; let call = 0;
  const k = fakeKoffi({ CFStringCreateWithCString: (_, value) => value, CFRelease: value => freed.push(value),
    IOPMAssertionCreateWithName: (_, level, name, id) => { assert.equal(level, 255); id[0] = 7; return call++ ? 1 : 0; },
    IOPMAssertionRelease: id => released.push(id),
  });
  assert.throws(() => acquireMac(k), /refused/); assert.deepEqual(released, [7]); assert.equal(freed.length, 4);
});
