// The read-only card must stay a reader: assertions run against the module
// source so they hold without a browser or a bundler.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

test('the card registers both slots and exposes the plugin identity', () => {
  assert.match(source, /plugins\.bundle\.config/);
  assert.match(source, /settings\.section/);
  assert.match(source, /module\.exports = \{ name: PKG, inject, apply: applyClient \}/);
});

test('the card only issues GET requests to the read-only routes', () => {
  assert.match(source, /fetch\('\/config-guard\/state'/);
  for (const forbidden of ["method: 'POST'", 'method: "POST"', '/config-guard/toggle', '/config-guard/apply', '/config-guard/pack/']) {
    assert.equal(source.includes(forbidden), false, `client.js must not reference ${forbidden}`);
  }
});

test('the card renders advice as text only', () => {
  assert.match(source, /suggestionsHeader/);
  assert.equal(source.includes('onClick: () => { void post('), false);
  assert.equal(source.includes('type: ' + "'checkbox'"), false, 'no inheritance switches in the read-only build');
});
