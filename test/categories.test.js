import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATEGORIES, categoryList, categoryOf, groupItems } from '../lib/categories.js';

test('rows land in purpose-based categories', () => {
  assert.equal(categoryOf('tool-bash'), 'tools');
  assert.equal(categoryOf('ui-theme'), 'appearance');
  assert.equal(categoryOf('model-provider'), 'models');
  assert.equal(categoryOf('session-store'), 'sessions');
  assert.equal(categoryOf('mcp-server-github'), 'integrations');
  assert.equal(categoryOf('skill-runner'), 'skills');
  assert.equal(categoryOf('usage-ledger'), 'usage');
  assert.equal(categoryOf('secret-vault'), 'security');
  assert.equal(categoryOf('something-local'), 'other');
});

test('every category has both labels and an order', () => {
  const list = categoryList();
  assert.equal(list.length, CATEGORIES.length + 1);
  for (const entry of list) {
    assert.equal(typeof entry.label.zh, 'string');
    assert.equal(typeof entry.label.en, 'string');
    assert.equal(typeof entry.order, 'number');
  }
});

test('groupItems drops empty buckets and keeps declared order', () => {
  const groups = groupItems([
    { id: 'usage-ledger' },
    { id: 'tool-bash' },
    { id: 'ui-theme' },
    { id: 'mystery-row' },
  ]);
  const labels = groups.map((group) => group.id);
  assert.deepEqual(labels, ['appearance', 'tools', 'usage', 'other']);
  assert.equal(groups.find((group) => group.id === 'tools').items.length, 1);
});
