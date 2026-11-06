import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyPresetDeclarations,
  describeItem,
  planEdits,
  presetDrift,
  STATUS,
  summarize,
} from '../lib/inspect.js';

const row = (id, inherited, override, name = `pkg-${id}`) => ({
  entry: { options: { id, name } },
  inherited,
  override,
});

test('a row without an override is fully inherited', () => {
  const { items, counts } = summarize([row('ui-theme', { preference: 'light' }, {})]);
  assert.equal(items[0].status, STATUS.INHERITED);
  assert.deepEqual(items[0].missingKeys, []);
  assert.equal(counts.inherited, 1);
});

test('an override that restates every inherited key is pinned but complete', () => {
  const { items } = summarize([row('agent-default-model', { provider: 'p', model: 'm' }, { provider: 'x', model: 'y' })]);
  assert.equal(items[0].status, STATUS.PINNED);
  assert.deepEqual(items[0].missingKeys, []);
});

test('a new inherited key that the override does not mention is reported as blocked', () => {
  const { items } = summarize([
    row('agent-default-model', { provider: 'p', model: 'm', reasoningEffort: 'high' }, { provider: 'x', model: 'y' }),
  ]);
  assert.equal(items[0].status, STATUS.BLOCKED);
  assert.deepEqual(items[0].missingKeys, ['reasoningEffort']);
});

test('a third-party row with no inherited layer is custom', () => {
  const { items } = summarize([row('plugin-market', {}, { indexes: [] })]);
  assert.equal(items[0].status, STATUS.CUSTOM);
});

test('applyPresetDeclarations keeps the new shipped rows and applies declared config', () => {
  const inherited = [
    { id: 'persona', name: 'pkg-persona', config: { prefix: 'v2' } },
    { id: 'tool-ask-user', name: 'pkg-tool-ask-user', config: { mode: 'inline' } },
  ];
  const expected = applyPresetDeclarations(inherited, { 'tool-ask-user': { mode: 'timed', timeout: 60 } });
  assert.equal(expected.length, 2);
  assert.deepEqual(expected[0].config, { prefix: 'v2' });
  assert.deepEqual(expected[1].config, { mode: 'timed', timeout: 60 });
});

test('applyPresetDeclarations accepts the {config} override shape and can add a row', () => {
  const expected = applyPresetDeclarations([], { extra: { config: { a: 1 }, name: 'pkg-extra' } });
  assert.deepEqual(expected, [{ id: 'extra', name: 'pkg-extra', config: { a: 1 } }]);
});

test('presetDrift reports missing, extra and changed rows', () => {
  const inherited = [
    { id: 'a', config: { x: 1 } },
    { id: 'b', config: { y: 2 } },
  ];
  const persisted = [
    { id: 'a', config: { x: 1 } },
    { id: 'c', config: {} },
  ];
  const drift = presetDrift(inherited, persisted, {});
  assert.equal(drift.stale, true);
  assert.deepEqual(drift.missingIds, ['b']);
  assert.deepEqual(drift.extraIds, ['c']);
});

test('presetDrift is clean when the persisted list equals inherited plus declarations', () => {
  const inherited = [{ id: 'a', config: { x: 1 } }, { id: 'b', config: { y: 2 } }];
  const persisted = applyPresetDeclarations(inherited, { b: { y: 3 } });
  const drift = presetDrift(inherited, persisted, { b: { y: 3 } });
  assert.equal(drift.stale, false);
});

test('planEdits restores only inherited keys and keeps the user values', () => {
  const configuration = [
    row('agent-default-model', { provider: 'p', model: 'm', reasoningEffort: 'high' }, { provider: 'example', model: 'demo' }),
  ];
  const edits = planEdits(configuration, {});
  assert.equal(edits.length, 1);
  assert.equal(edits[0].kind, 'merge');
  assert.deepEqual(edits[0].restoredKeys, ['reasoningEffort']);
  assert.deepEqual(edits[0].next, { provider: 'example', model: 'demo', reasoningEffort: 'high' });
});

test('a preset row that lost shipped plugins plans a list rebase', () => {
  const configuration = [
    row('preset-standard', {
      id: 'standard',
      order: 1,
      plugins: [{ id: 'persona', config: { prefix: 'v2' } }, { id: 'new-row', config: { on: true } }],
    }, {
      id: 'standard',
      order: 1,
      plugins: [{ id: 'persona', config: { prefix: 'v1' } }],
    }),
  ];
  const edits = planEdits(configuration, {});
  assert.equal(edits.length, 1);
  assert.equal(edits[0].kind, 'preset');
  assert.deepEqual(edits[0].next.plugins.map((entry) => entry.id), ['persona', 'new-row']);
  assert.deepEqual(edits[0].next.plugins[0].config, { prefix: 'v2' });
});

test('a preset declaration is applied on top of the shipped list', () => {
  const configuration = [
    row('preset-standard', {
      id: 'standard',
      plugins: [{ id: 'tool-ask-user', config: { mode: 'inline' } }],
    }, {
      id: 'standard',
      plugins: [{ id: 'tool-ask-user', config: { mode: 'inline' } }],
    }),
  ];
  const edits = planEdits(configuration, { presets: { 'preset-standard': { 'tool-ask-user': { mode: 'timed', timeout: 60 } } } });
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0].next.plugins[0].config, { mode: 'timed', timeout: 60 });
});

test('disabled rows are reported but never planned', () => {
  const configuration = [row('agent-default-model', { a: 1, b: 2 }, { a: 9 })];
  const { items } = summarize(configuration, { disabled: ['agent-default-model'] });
  assert.equal(items[0].disabled, true);
  assert.deepEqual(planEdits(configuration, { disabled: ['agent-default-model'] }), []);
});

test('disableAll switches every row off', () => {
  const configuration = [row('agent-default-model', { a: 1, b: 2 }, { a: 9 })];
  const { items } = summarize(configuration, { disableAll: true });
  assert.equal(items[0].disabled, true);
  assert.deepEqual(planEdits(configuration, { disableAll: true }), []);
});

test('describeItem explains each status in Chinese', () => {
  const blocked = summarize([row('x', { a: 1, b: 2 }, { a: 9 })]).items[0];
  assert.match(describeItem(blocked), /缺 1 个继承键/);
  const inherited = summarize([row('y', { a: 1 }, {})]).items[0];
  assert.match(describeItem(inherited), /完全继承/);
});
