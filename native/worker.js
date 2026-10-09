import { acquire } from './adapters.js';

let lease, stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  try { lease?.release(); } finally { process.exit(code); }
}
// The parent owns this pipe. EOF also releases assertions after parent crash.
process.stdin.resume();
process.stdin.on('end', () => stop());
process.stdin.on('error', () => stop());
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
try {
  lease = await acquire();
  process.stdout.write(JSON.stringify({ kind: 'ready', ...lease.report }) + '\n');
  setInterval(() => {
    try { lease.check?.(); }
    catch (error) { process.stdout.write(JSON.stringify({ kind: 'error', error: error.message }) + '\n'); stop(1); }
  }, 15000);
} catch (error) {
  process.stdout.write(JSON.stringify({ kind: 'error', error: error.message }) + '\n');
  stop(1);
}
