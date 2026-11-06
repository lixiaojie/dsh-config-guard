import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildSuggestions } from '../lib/suggest.js';

test('health score drops with severity and stays clamped', () => {
  const clean = buildSuggestions({});
  assert.equal(clean.health.score, 100);
  assert.equal(clean.health.level, 'healthy');
  assert.deepEqual(clean.suggestions, []);

  const rough = buildSuggestions({
    findings: [
      { id: 'secret:apiKey', severity: 'error', group: 'secrets', title: '配置里疑似含密钥', detail: '第 3 行' },
      { id: 'orphan:gone-row', severity: 'warn', group: 'config', title: '孤儿配置行', detail: 'patch 里的 gone-row 在运行时不存在' },
      { id: 'abs-patch', severity: 'info', group: 'config', title: '配置里含绝对路径', detail: '14 处' },
    ],
  });
  assert.equal(rough.health.counts.high, 1);
  assert.equal(rough.health.counts.medium, 1);
  assert.equal(rough.health.counts.low, 1);
  assert.equal(rough.health.score, 100 - 18 - 7 - 2);
  assert.equal(rough.health.level, 'attention');
  assert.equal(rough.suggestions[0].severity, 'high');
});

test('every suggestion is advice only in the read-only build', () => {
  const out = buildSuggestions({
    findings: [
      { id: 'orphan:example', severity: 'warn', group: 'config', title: '孤儿配置行', detail: 'x' },
      { id: 'bundle-missing:@deepseek-ai/dsh-old', severity: 'error', group: 'plugins', title: 'bundle 已被当前版本移除', detail: 'y' },
      { id: 'abs-patch', severity: 'info', group: 'config', title: '配置里含绝对路径', detail: '14 处' },
    ],
  });
  const byId = new Map(out.suggestions.map((suggestion) => [suggestion.id, suggestion]));
  assert.equal(byId.get('fix:orphan:example').action, null, 'read-only build offers no action');
  assert.equal(byId.get('fix:bundle-missing:@deepseek-ai/dsh-old').action, null);
  assert.equal(byId.get('fix:abs-patch').action, null);
});

test('blocked rows still get one high-severity suggestion', () => {
  const out = buildSuggestions({
    items: [
      { id: 'tool-bash', status: 'blocked' },
      { id: 'ui-theme', status: 'blocked' },
      { id: 'session-store', status: 'pinned' },
      { id: 'usage-ledger', status: 'inherited' },
    ],
  });
  const blocked = out.suggestions.find((suggestion) => suggestion.id === 'fix:blocked-rows');
  assert.equal(blocked.severity, 'high');
  assert.equal(blocked.action, null, 'no apply-edits action is advertised');
  assert.equal(blocked.group, 'config');
  assert.ok(out.suggestions.some((suggestion) => suggestion.id === 'fix:pinned-rows'));
});

test('heavy assets and pack pile-ups are flagged as housekeeping', () => {
  const dir = mkdtempSync(join(tmpdir(), 'config-guard-suggest-'));
  const pack = join(dir, 'a.dshpack.tar.gz');
  writeFileSync(pack, Buffer.alloc(2048));
  const out = buildSuggestions({
    sources: [{ id: 'skills.content', label: '技能内容', group: 'skills', size: 90e6, defaultOn: true }],
    packs: [1, 2, 3, 4].map((index) => ({ name: `p${index}`, path: pack })),
  });
  const trim = out.suggestions.find((suggestion) => suggestion.id === 'trim:skills.content');
  assert.equal(trim.action, null);
  assert.match(trim.title, /占/);
  const packs = out.suggestions.find((suggestion) => suggestion.id === 'clean:packs');
  assert.match(packs.title, /4 个/);
});

test('usage data turns into idle-tool and top-tool advice', () => {
  const usage = {
    available: true,
    window: { days: 30, from: '2026-10-07', to: '2026-11-06' },
    sessions: 12,
    totalCalls: 500,
    activeDays: 5,
    tools: [{ name: 'bash', calls: 480 }, { name: 'read', calls: 20 }],
    models: [],
  };
  const out = buildSuggestions({ usage, pluginIds: ['tool-bash', 'tool-read', 'tool-glob', 'tool-grep', 'tool-todo', 'ui-theme', 'session-store'] });
  const idle = out.suggestions.find((suggestion) => suggestion.id === 'usage:idle-tools');
  assert.ok(idle, 'idle-tools suggestion missing');
  assert.match(idle.title, /3 个已知工具入口没有调用记录/, 'only known tool entry points are judged');
  assert.match(idle.detail, /tool-glob/);
  assert.equal(idle.detail.includes('ui-theme'), false, 'non-tool rows must not be listed as idle tools');
  assert.equal(idle.detail.includes('session-store'), false, 'session rows must not be listed as idle tools');
  const top = out.suggestions.find((suggestion) => suggestion.id === 'usage:top-tool');
  assert.match(top.title, /bash（480 次）/);
  assert.ok(out.suggestions.some((suggestion) => suggestion.id === 'usage:skills-idle'));
});

test('usage advice stays silent without activity data', () => {
  const out = buildSuggestions({ usage: { available: false, tools: [] }, pluginIds: ['tool-bash'] });
  assert.equal(out.suggestions.some((suggestion) => String(suggestion.id).startsWith('usage:')), false);
});
