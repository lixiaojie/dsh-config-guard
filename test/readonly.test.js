// The read-only build must never write. These tests pin that property at the
// three places a write could hide: the declared routes, the module surface, and
// the filesystem after a full snapshot.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { apply } from '../lib/index.js';

function fakeHost({ withEditor = true } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'config-guard-ro-'));
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    dependencies: { '@deepseek-ai/dsh-tool-bash': '0.2.1-rc.5' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }));
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: preset-standard\n  config:\n    id: standard\n');
  const configuration = [
    {
      entry: { options: { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model' } },
      inherited: { provider: 'example', model: 'a', reasoningEffort: 'high' },
      override: { provider: 'example', model: 'b' },
    },
    {
      entry: { options: { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' } },
      inherited: { timeout: 10 },
      override: { timeout: 20 },
    },
  ];
  let handler;
  const ctx = {
    profileContext: { dir: profile },
    effect(fn) { return fn(); },
    webServer: { register(options) { handler = options.handler; return () => {}; } },
    appReady: { onReady() {} },
    pluginManager: {
      async listBundles() { return [{ name: '@deepseek-ai/dsh-base', version: '0.2.1-rc.5' }]; },
      async listVersionExemptions() { return { exemptions: {} }; },
    },
    ...(withEditor ? { configEditor: { documentPath: join(profile, 'cordis.patch.yml'), configuration() { return configuration; } } } : {}),
  };
  const call = async (method, path) => {
    const chunks = [];
    const response = {
      headers: {},
      writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
      end(chunk) { if (chunk !== undefined) chunks.push(String(chunk)); this.body = chunks.join(''); },
    };
    await handler({ method, url: path, headers: { host: 'localhost' } }, response);
    return { status: response.status, json: response.body.length > 0 ? JSON.parse(response.body) : null };
  };
  return { profile, ctx, call, files: () => readdirSync(profile).sort() };
}

test('only GET routes exist and nothing is written', async () => {
  const host = fakeHost();
  const before = host.files();
  apply(host.ctx, { home: host.profile, checkOnStartup: true, checkIntervalMinutes: 0 });

  const state = await host.call('GET', '/config-guard/state');
  assert.equal(state.status, 200);
  assert.equal(state.json.ok, true);
  assert.equal(state.json.readOnly, true);
  assert.equal(state.json.degraded, false);
  assert.equal(state.json.items.length, 2);
  assert.ok(Array.isArray(state.json.categories) && state.json.categories.length > 0);
  assert.ok(state.json.usage !== undefined);

  const assets = await host.call('GET', '/config-guard/assets');
  assert.equal(assets.status, 200);
  assert.ok(Array.isArray(assets.json.assets.sources));

  for (const [method, path] of [['POST', '/config-guard/toggle'], ['POST', '/config-guard/repair'], ['POST', '/config-guard/pack/export'], ['GET', '/config-guard/pack/download']]) {
    const response = await host.call(method, path);
    assert.equal(response.status === 404 || response.status === 405, true, `${method} ${path} must be rejected`);
  }

  const after = host.files();
  assert.deepEqual(after, before, 'a snapshot must not create files (no state file, no backups)');
});

test('a host without configEditor degrades instead of failing', async () => {
  const host = fakeHost({ withEditor: false });
  apply(host.ctx, { home: host.profile, checkOnStartup: false, checkIntervalMinutes: 0 });
  const state = await host.call('GET', '/config-guard/state');
  assert.equal(state.status, 200);
  assert.equal(state.json.degraded, true);
  assert.match(String(state.json.degradedReason), /configEditor/);
  assert.deepEqual(state.json.items, []);
  assert.ok(state.json.assets.sources.length > 0, 'assets are still collected');
});

test('the module surface exposes no write helper', () => {
  const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  for (const forbidden of ['writeFileSync', 'copyFileSync', 'rmSync', 'configEditor.edit', 'repair', 'toggle', 'pack/export']) {
    assert.equal(source.includes(forbidden), false, `index.js must not reference ${forbidden}`);
  }
  const routes = readFileSync(new URL('../lib/routes.js', import.meta.url), 'utf8');
  assert.equal(/method === 'POST'/.test(routes), false, 'routes must not branch on POST');
  assert.equal(existsSync(new URL('../lib/pack.js', import.meta.url)), false, 'the pack module is not shipped');
});
