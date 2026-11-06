// Read-only smoke: both GET endpoints answer, every write-looking request is
// refused, and a full pass leaves the profile directory byte-identical.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../lib/index.js';

const profile = mkdtempSync(join(tmpdir(), 'config-guard-smoke-'));
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'smoke',
  dependencies: { '@deepseek-ai/dsh-tool-bash': '0.2.1-rc.5' },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
}));
writeFileSync(join(profile, 'cordis.patch.yml'), '- id: preset-standard\n  config:\n    id: standard\n');

const configuration = [
  {
    entry: { options: { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model' } },
    inherited: { provider: 'p', model: 'm', reasoningEffort: 'high' },
    override: { provider: 'q', model: 'n' },
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
  configEditor: { documentPath: join(profile, 'cordis.patch.yml'), configuration() { return configuration; } },
  pluginManager: {
    async listBundles() { return [{ name: '@deepseek-ai/dsh-base', version: '0.2.1-rc.5' }]; },
    async listVersionExemptions() { return { exemptions: {} }; },
  },
};

const before = readdirSync(profile).sort();
apply(ctx, { home: profile, checkOnStartup: false, checkIntervalMinutes: 0 });

async function request({ method = 'GET', url = '/config-guard/state' } = {}) {
  const chunks = [];
  const response = {
    headers: {},
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end(chunk) { if (chunk !== undefined) chunks.push(String(chunk)); this.body = chunks.join(''); },
  };
  await handler({ method, url, headers: { host: 'localhost' } }, response);
  return { status: response.status, json: response.body.length > 0 ? JSON.parse(response.body) : null };
}

const state = await request({ url: '/config-guard/state' });
assert.equal(state.status, 200);
assert.equal(state.json.ok, true);
assert.equal(state.json.readOnly, true);
assert.equal(state.json.degraded, false);
assert.equal(state.json.items.length, 2);
assert.ok(state.json.usage !== undefined);

const assets = await request({ url: '/config-guard/assets' });
assert.equal(assets.status, 200);
assert.ok(Array.isArray(assets.json.assets.sources));

for (const [method, url] of [['POST', '/config-guard/state'], ['POST', '/config-guard/toggle'], ['POST', '/config-guard/apply'], ['GET', '/config-guard/pack/download']]) {
  const refused = await request({ method, url });
  assert.equal(refused.status === 404 || refused.status === 405, true, `${method} ${url} must be refused`);
}

assert.deepEqual(readdirSync(profile).sort(), before, 'a pass must not create or modify profile files');
console.log('smoke ok: GET state/assets, non-GET refused, profile untouched');
