// The installer is the only thing a colleague runs, so its promises are tested
// too: a dry run must touch nothing, and its closing message must not describe
// features this build does not have (state file, restore buttons).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const installer = new URL('install.mjs', root).pathname;
const source = new URL('.', root).pathname.replace(/\/$/, '');

function fakeProfile() {
  const dir = mkdtempSync(join(tmpdir(), 'config-guard-install-'));
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'fake-profile',
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }, null, 2));
  writeFileSync(join(dir, 'cordis.patch.yml'), '- id: ui-theme\n  config:\n    a: 1\n');
  return dir;
}

test('a dry run reports the plan and changes nothing', () => {
  const profile = fakeProfile();
  const before = readdirSync(profile).sort();
  const out = execFileSync(process.execPath, [installer, '--profile', profile, '--source', source, '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /\[dry-run\]/);
  assert.match(out, /dsh\.profile\.bundles \+= dsh-config-guard/);
  assert.equal(/状态文件：/.test(out), false, 'the installer must not announce a state file');
  assert.equal(out.includes('补齐'), false, 'read-only build has no restore action');
  assert.equal(readdirSync(profile).sort().join(','), before.join(','), 'dry run must not write');
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, {});
});
