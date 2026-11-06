import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  bundlesOf,
  collectProfileGuard,
  connectionRow,
  cookieJarPath,
  countAuthCookies,
  diffProfile,
  listSnapshots,
  readProfileState,
} from '../lib/profile-guard.js';

const PATCH = (cookieMaxAgeDays) => `# user patch\n- id: ui-theme\n  config:\n    a: 1\n${cookieMaxAgeDays === null ? '' : `- id: connection\n  config:\n    cookieMaxAgeDays: ${cookieMaxAgeDays}\n    trustedHosts: []\n`}- id: web\n  config: {}\n`;

function profile(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pg-'));
  const manifest = { name: 'p', dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(overrides.manifest ?? manifest, null, 2)}\n`);
  writeFileSync(join(dir, 'cordis.patch.yml'), overrides.patch ?? PATCH(2));
  return dir;
}

test('reads the bundle roster and the connection row without a YAML dependency', () => {
  assert.deepEqual(bundlesOf('{"dsh":{"profile":{"bundles":["a","b"]}}}'), ['a', 'b']);
  assert.deepEqual(bundlesOf('not json'), []);
  assert.deepEqual(connectionRow(PATCH(2)), { present: true, cookieMaxAgeDays: 2 });
  assert.deepEqual(connectionRow(PATCH(null)), { present: false, cookieMaxAgeDays: null });
  assert.deepEqual(connectionRow(''), { present: false, cookieMaxAgeDays: null });
  // a nested `cookieMaxAgeDays` outside the connection row must not leak in
  assert.deepEqual(connectionRow('- id: other\n  config:\n    cookieMaxAgeDays: 9\n- id: connection\n  config:\n    trustedHosts: []\n'), { present: true, cookieMaxAgeDays: null });
});

test('a lost bundle roster is an error finding', () => {
  // The read-only build never writes a snapshot, so the history comes from a
  // store the full build left behind: plant one and diff the live profile.
  const dir = profile();
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
  const stamp = join(home, '.dsh', 'config-guard', 'snapshots', '20260101T000000000');
  mkdirSync(stamp, { recursive: true });
  writeFileSync(join(stamp, 'manifest.json'), JSON.stringify({
    schema: 1,
    at: '2026-01-01T00:00:00.000Z',
    digest: 'x',
    files: {},
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    patchBytes: 2048,
    connection: null,
  }));
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }, null, 2)}
`);
  const next = collectProfileGuard({ home, profileDir: dir, platform: 'linux' });
  assert.equal(next.written, false, 'read-only build must not write snapshots');
  const lost = next.findings.find((finding) => finding.id === 'profile:bundles-lost');
  assert.ok(lost, 'expected a bundles-lost finding');
  assert.equal(lost.severity, 'error');
  assert.match(lost.detail, /dsh-web-app/);
});

test('a collapsed patch layer is an error finding, a small one is not noise', () => {
  const dir = profile();
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
  const stamp = join(home, '.dsh', 'config-guard', 'snapshots', '20260101T000000000');
  mkdirSync(stamp, { recursive: true });
  writeFileSync(join(stamp, 'manifest.json'), JSON.stringify({
    schema: 1,
    at: '2026-01-01T00:00:00.000Z',
    digest: 'y',
    files: {},
    bundles: ['@deepseek-ai/dsh-base'],
    patchBytes: 4096,
    connection: null,
  }));
  writeFileSync(join(dir, 'cordis.patch.yml'), '- id: ui-theme\n  config:\n    a: 1\n');
  const collapsed = collectProfileGuard({ home, profileDir: dir, platform: 'linux' });
  assert.ok(collapsed.findings.some((finding) => finding.id === 'profile:patch-collapsed'));
  const healthy = collectProfileGuard({ home: mkdtempSync(join(tmpdir(), 'dsh-home-')), profileDir: profile(2048), platform: 'linux' });
  assert.equal(healthy.findings.some((finding) => finding.id === 'profile:patch-collapsed'), false);
});

test('cookie lifetime above the warn threshold and a missing row are both reported', () => {
  const previous = { bundles: ['a'], patchBytes: 4000, connection: { present: true, cookieMaxAgeDays: 2 } };
  const long = diffProfile(previous, { bundles: ['a'], patchBytes: 4000, connection: { present: true, cookieMaxAgeDays: 30 } });
  assert.ok(long.some((finding) => finding.id === 'profile:cookie-lifetime-long'));
  const missing = diffProfile(previous, { bundles: ['a'], patchBytes: 4000, connection: { present: false, cookieMaxAgeDays: null } });
  assert.ok(missing.some((finding) => finding.id === 'profile:connection-missing'));
  const unset = diffProfile(previous, { bundles: ['a'], patchBytes: 4000, connection: { present: true, cookieMaxAgeDays: null } });
  assert.ok(unset.some((finding) => finding.id === 'profile:cookie-lifetime-unset'));
});

test('a profile directory without package.json is skipped instead of throwing', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
  const empty = mkdtempSync(join(tmpdir(), 'dsh-empty-'));
  const result = collectProfileGuard({ home, profileDir: empty, write: true, platform: 'linux' });
  assert.deepEqual(result.findings, []);
  assert.equal(result.snapshots, 0);
  assert.equal(result.written, false);
});

test('the cookie jar path follows the platform and an absent jar is null', () => {
  assert.match(cookieJarPath('/Users/x', 'darwin'), /Library\/Application Support\/@deepseek-ai\/dsh-desktop\/Cookies$/);
  assert.equal(cookieJarPath('/Users/x', 'win32', {}), null);
  assert.match(cookieJarPath('/Users/x', 'linux'), /\.config\/@deepseek-ai\/dsh-desktop\/Cookies$/);
  assert.equal(countAuthCookies('/nonexistent-home', { platform: 'linux' }), null);
});

test('an auth cookie jar is counted read-only when sqlite3 is available', (t) => {
  let hasSqlite = true;
  try {
    execFileSync('sqlite3', ['--version'], { stdio: 'ignore' });
  } catch {
    hasSqlite = false;
  }
  if (!hasSqlite) return t.skip('sqlite3 not installed');
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
  const dir = join(home, 'Library', 'Application Support', '@deepseek-ai', 'dsh-desktop');
  mkdirSync(dir, { recursive: true });
  const db = join(dir, 'Cookies');
  execFileSync('sqlite3', [db, 'CREATE TABLE cookies (name TEXT, value TEXT, host_key TEXT, creation_utc INTEGER);']);
  execFileSync('sqlite3', [db, `INSERT INTO cookies VALUES ${Array.from({ length: 45 }, (_, index) => `('dsh-auth-${index}','${'x'.repeat(200)}','127.0.0.1',${index})`).join(',')};`]);
  const jar = countAuthCookies(home, { platform: 'darwin', ttlMs: 0 });
  assert.equal(jar.available, true);
  assert.equal(jar.count, 45);
  assert.ok(jar.bytes > 45 * 200);
  // 45 cookies is over the warn threshold, under the error threshold
  const result = collectProfileGuard({ home, profileDir: profile(), write: false, platform: 'darwin', cookieTtlMs: 0 });
  assert.ok(result.findings.some((finding) => finding.id === 'profile:cookie-jar-growing'));
  rmSync(home, { recursive: true, force: true });
});
