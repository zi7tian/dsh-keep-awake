import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function createNativeManager({ spawnProcess = spawn, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let count = 0, enabled = true, disposed = false, child = null, retry = null, startup = null, failures = 0;
  let state = { status: 'idle', display: false, sleep: false };
  const snapshot = () => ({ ...state, count, enabled, platform: process.platform });
  const clear = () => {
    if (retry) unschedule(retry);
    if (startup) unschedule(startup);
    retry = startup = null;
  };
  function stop() {
    clear();
    const old = child; child = null;
    if (old && old.exitCode == null && old.signalCode == null) {
      old.stdin.end();
      const timer = schedule(() => old.kill('SIGKILL'), 2500);
      timer.unref?.();
      old.once('exit', () => unschedule(timer));
    }
  }
  function retryLater() {
    if (disposed || !enabled || !count || retry) return;
    retry = schedule(() => { retry = null; start(); }, Math.min(1000 * 2 ** Math.min(failures++, 6), 60000));
    retry.unref?.();
  }
  function start() {
    if (disposed || !enabled || !count || child || retry) return;
    state = { status: 'requesting', display: false, sleep: false };
    let worker;
    try {
      worker = spawnProcess(process.execPath, [fileURLToPath(new URL('./worker.js', import.meta.url))], {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
    } catch (error) { state = { status: 'error', error: error.message, display: false, sleep: false }; retryLater(); return; }
    child = worker;
    worker.stdin.on('error', () => {});
    const failed = error => {
      if (child !== worker) return;
      stop();
      state = { status: 'error', error: String(error).slice(0, 500), display: false, sleep: false };
      retryLater();
    };
    worker.on('error', error => failed(error.message));
    worker.once('exit', code => failed(`Native helper exited (${code})`));
    let buffer = '';
    worker.stdout.on('data', chunk => {
      if (child !== worker) return;
      buffer += chunk;
      if (buffer.length > 16384) { failed('Invalid native helper output'); return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const message = JSON.parse(line);
          if (message.kind === 'error') { failed(message.error); return; }
          if (message.kind === 'ready') {
            if (typeof message.display !== 'boolean' || typeof message.sleep !== 'boolean') {
              failed('Invalid native helper capabilities'); return;
            }
            if (startup) unschedule(startup); startup = null;
            const { kind, ...report } = message;
            state = { ...report, status: message.display && message.sleep ? 'active' : 'partial' };
          }
        } catch { failed('Invalid native helper response'); return; }
      }
    });
    startup = schedule(() => failed('Native helper startup timed out'), 15000);
    startup.unref?.();
  }
  function reconcile() {
    if (!enabled || !count || disposed) {
      stop(); failures = 0;
      state = { status: enabled && !disposed ? 'idle' : 'disabled', display: false, sleep: false };
    } else start();
  }
  return {
    snapshot,
    update(nextCount) { count = nextCount; reconcile(); },
    setEnabled(value) { enabled = value; reconcile(); },
    dispose() { disposed = true; reconcile(); },
  };
}
