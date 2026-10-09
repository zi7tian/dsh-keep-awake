import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const patch = readFileSync(new URL('cordis.patch.yml', root), 'utf8');
const client = readFileSync(new URL('client.js', root), 'utf8');

test('bundle uses exact package name so DSH discovers both host and client', () => {
  const name = patch.match(/^\s+name:\s*(\S+)\s*$/m)?.[1];
  assert.equal(name, manifest.name, 'subpath names silently disable DSH client discovery');
  assert.equal(manifest.dsh.client.platform, 'web');
  for (const entry of ['.', './client']) {
    const path = manifest.exports[entry];
    assert.ok(existsSync(new URL(path, root)), entry);
    assert.ok(manifest.files.includes(path.replace(/^\.\//, '')), entry);
  }
});

test('client registers host control panel without browser wake lock or session dependencies', () => {
  let registration;
  vm.runInNewContext(client, { window: { __ModuleLoader__: { load: value => { registration = value; } } } });
  assert.equal(registration.id, manifest.name);
  const plugin = registration.factory(name => {
    assert.ok(['react', 'react-dom'].includes(name)); return {};
  });
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale']);
  assert.equal(typeof plugin.apply, 'function');
  assert.doesNotMatch(client, /navigator\.wakeLock|localStorage|sessionStatus|createController/);
  assert.ok(!manifest.dsh.client.inject.some(name => /ui-session|client-connection/.test(name)));
});

test('native runtime files are included and no host subpath export remains', () => {
  assert.ok(manifest.files.includes('native'));
  for (const file of ['adapters.js', 'manager.js', 'worker.js']) assert.ok(existsSync(new URL('native/' + file, root)));
  assert.equal(manifest.exports['./host'], undefined);
});
