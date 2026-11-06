import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectUsage, MCP_KNOWN, pluginForTool } from '../lib/usage.js';

function cache(files) {
  const home = mkdtempSync(join(tmpdir(), 'config-guard-usage-'));
  const dir = join(home, '.dsh/storages/session_projcache/sessions');
  mkdirSync(dir, { recursive: true });
  for (const [name, record] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(record));
  return home;
}

const session = (days) => ({
  version: 7,
  record: {
    identity: { formatVersion: 4, createdAt: 1793785392507, cwd: '/tmp/project' },
    rows: {
      contextActivity: { val: { days } },
      modelSelection: { val: { lastUsed: { provider: 'p', model: 'm' } } },
    },
  },
});

test('aggregates tool calls inside the window and skips old days', () => {
  const home = cache({
    'a.json': session({
      '2026-11-05': { tools: { bash: { n: 3, last: 1000 }, read: { n: 2, last: 900 } } },
      '2026-01-01': { tools: { bash: { n: 99, last: 1 } } },
    }),
    'b.json': session({ '2026-11-06': { tools: { bash: { n: 4, last: 2000 } } } }),
    'broken.json': { not: 'a session' },
  });
  const usage = collectUsage({ home, days: 30, now: new Date('2026-11-06T12:00:00Z') });
  assert.equal(usage.available, true);
  assert.equal(usage.scanned, 3);
  assert.equal(usage.window.from, '2026-10-07');
  assert.equal(usage.totalCalls, 9);
  assert.equal(usage.activeDays, 2);
  assert.deepEqual(usage.tools.map((tool) => [tool.name, tool.calls]), [['bash', 7], ['read', 2]]);
  assert.equal(usage.tools[0].sessions, 2);
  assert.equal(usage.models[0].name, 'p/m');
});

test('missing cache directory degrades into a note, never a throw', () => {
  const home = mkdtempSync(join(tmpdir(), 'config-guard-usage-empty-'));
  const usage = collectUsage({ home });
  assert.equal(usage.available, false);
  assert.match(String(usage.note), /没有找到/);
  assert.deepEqual(usage.tools, []);
});

test('tool names map back to plugin rows', () => {
  assert.equal(pluginForTool('bash', ['tool-bash', 'ui-theme']), 'tool-bash');
  assert.equal(pluginForTool('read', ['dsh-tool-read']), 'dsh-tool-read');
  assert.equal(pluginForTool('browser_click', ['dsh-browser-tools']), 'dsh-browser-tools');
  assert.equal(pluginForTool('mystery', ['ui-theme']), null);
  assert.equal(MCP_KNOWN.bash, 'tool-bash');
});
