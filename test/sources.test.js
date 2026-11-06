import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { absolutePaths, catalog, linkTarget, scanSecrets, scanSources, upgradeFindings } from '../lib/sources.js';

const home = mkdtempSync(join(tmpdir(), 'config-guard-sources-'));

test('catalog covers plugins, config, prefs, skills, workspace and secrets', () => {
  const sources = catalog({ home, profileName: 'desktop' });
  const groups = new Set(sources.map((source) => source.group));
  for (const group of ['plugins', 'config', 'prefs', 'skills', 'workspace', 'secrets']) assert.ok(groups.has(group), group);
  const secret = sources.find((source) => source.group === 'secrets');
  assert.equal(secret.default, false);
  assert.equal(secret.secret, true);
  const skills = sources.find((source) => source.id === 'skills.content');
  assert.equal(skills.default, true, 'skill bodies travel by default');
  assert.equal(skills.optional, true, 'but the export can drop them');
});

test('scanSources reports size and dir counts', () => {
  const profile = join(home, '.dsh/profiles/desktop');
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'package.json'), '{"name":"x"}');
  mkdirSync(join(home, '.dsh/task-board'), { recursive: true });
  writeFileSync(join(home, '.dsh/task-board/ledger.json'), '{}');
  const scanned = scanSources(catalog({ home }));
  assert.equal(scanned.find((source) => source.id === 'profile.manifest').exists, true);
  const board = scanned.find((source) => source.id === 'prefs.task-board');
  assert.equal(board.exists, true);
  assert.equal(board.files, 1);
  assert.equal(scanned.find((source) => source.id === 'secrets.credentials').exists, false);
});

test('absolutePaths finds home-style paths only once', () => {
  const paths = absolutePaths('a: /home/user/project b: /home/user/project c: /home/u/y');
  assert.deepEqual(paths.sort(), ['/home/u/y', '/home/user/project']);
});

test('scanSecrets reports kind and line, never the value', () => {
  const text = ['rows:', '  - key: sk-FIXTURE00000000000000000000000', '  - other: ghp_FIXTURE000000000000000000000'].join('\n');
  const matches = scanSecrets(text);
  assert.deepEqual(matches.map((match) => match.kind).sort(), ['github-token', 'openai-style']);
  assert.ok(matches.every((match) => typeof match.line === 'number'));
  assert.equal(JSON.stringify(matches).includes('sk-FIXTURE00'), false);
});

test('upgradeFindings flags pins, missing links, removed bundles and orphans', () => {
  const findings = upgradeFindings({
    home,
    runtimeVersion: '0.2.1-rc.5',
    manifest: {
      dependencies: {
        '@deepseek-ai/dsh-subagent-codex': '0.1.0',
        'dsh-local': `link:${join(home, 'missing-plugin')}`,
        'dsh-remote': 'link:/Users/someone/projects/plugin',
        'dsh-vendor': 'link:vendor/dsh-vendor',
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/removed-bundle'] } },
    },
    availableBundles: [{ name: '@deepseek-ai/dsh-base' }],
    configuration: [{ entry: { options: { id: 'ui-theme' } } }],
    patchRowIds: ['ui-theme', 'gone-row'],
    patchPaths: ['/home/user/project'],
    secretMatches: [{ kind: 'openai-style', line: 3 }],
    workspacePaths: [join(home, 'nope')],
    profileDir: join(home, '.dsh/profiles/desktop'),
    skillsLock: { skills: { a: {} } },
    skillDirs: ['a', 'b'],
  });
  const ids = findings.map((finding) => finding.id);
  for (const expected of [
    'pin:@deepseek-ai/dsh-subagent-codex',
    'link-missing:dsh-local',
    'link-outside:dsh-remote',
    'bundle-missing:@deepseek-ai/removed-bundle',
    'orphan:gone-row',
    'abs-patch',
    'secret:openai-style',
    'workspace-missing',
    'skills-unlocked',
  ]) {
    assert.ok(ids.includes(expected), expected);
  }
  assert.equal(findings.find((finding) => finding.id === 'bundle-missing:@deepseek-ai/removed-bundle').severity, 'error');
  assert.ok(!ids.includes('link-outside:dsh-vendor'), 'relative link under the profile counts as inside');
});

test('linkTarget parses only link specs', () => {
  assert.equal(linkTarget('link:/tmp/x'), '/tmp/x');
  assert.equal(linkTarget('^1.2.3'), null);
});
