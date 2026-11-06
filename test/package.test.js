// Mirrors the catalog's static gate: it never installs or runs this package, it
// only checks that the manifest declares `dsh.bundle.patch` and that the patch
// file it names exists in the same tree. Passing here means the submission
// review should pass too.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

test('manifest declares a bundle patch that exists in the tree', () => {
  const patch = pkg?.dsh?.bundle?.patch;
  assert.equal(typeof patch, 'string');
  assert.ok(String(patch).length > 0, 'dsh.bundle.patch must be non-empty');
  assert.equal(existsSync(new URL(patch.replace(/^\.\//, ''), root)), true, `${patch} is missing`);
});

test('package metadata is publishable', () => {
  assert.match(pkg.name, /^[a-z0-9][a-z0-9._-]*$/);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.type, 'module');
  assert.ok(existsSync(new URL('LICENSE', root)), 'LICENSE missing');
  assert.ok(existsSync(new URL('README.md', root)), 'README missing');
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('lib'));
});

test('catalog entry matches the schema shape', () => {
  const entry = JSON.parse(readFileSync(new URL('catalog/plugins.json.example', root), 'utf8'));
  assert.deepEqual(Object.keys(entry).sort(), ['$schema', 'added', 'category', 'description', 'id', 'name', 'repository']);
  assert.equal(entry.$schema, '../schema/plugin.schema.json');
  assert.match(entry.id, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(entry.repository, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(entry.id, new RegExp(entry.repository.split('github.com/')[1].toLowerCase() + '$', 'i'), 'id must name the repository');
  for (const lang of ['en', 'zh']) {
    assert.equal(typeof entry.description[lang], 'string');
    assert.ok(entry.description[lang].length > 20 && entry.description[lang].length <= 1000);
  }
  assert.match(entry.added, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(['ui', 'theme', 'session', 'memory', 'tools', 'skill', 'workflow', 'notify', 'model', 'dev', 'fun'].includes(entry.category));
});
