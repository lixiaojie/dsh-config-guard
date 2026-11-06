// Renders the real card with a tiny React stand-in and a stubbed endpoint, so
// the wiring (which payload field reaches which section) is exercised without a
// browser or a bundler. The source-level assertions live in client.test.js; this
// file proves the data actually shows up.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const payload = {
  ok: true,
  readOnly: true,
  checkedAt: '2026-11-06T07:58:12.000Z',
  runtime: { profile: '/tmp/profile', version: '0.2.2-rc.1' },
  items: [
    { id: 'ui-theme', name: '@deepseek-ai/dsh-client-ui-theme', status: 'blocked', category: 'appearance', description: '补齐 1 个键', missingKeys: ['theme.density'] },
    { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', status: 'inherited', category: 'tools', description: '完全继承' },
  ],
  counts: { total: 2, blocked: 1 },
  categories: [
    { id: 'appearance', label: { zh: '界面与外观', en: 'Appearance' } },
    { id: 'tools', label: { zh: '工具与效率', en: 'Tools' } },
  ],
  health: { score: 79, level: 'attention', counts: { high: 0, medium: 1, low: 2 } },
  suggestions: [{ id: 'usage:top-tool', severity: 'low', title: '最常用的是 bash', detail: '5395 次', action: null }],
  profileGuard: { snapshots: 3, latest: { stamp: '20261106T075812000' }, cookieJar: { count: 12, bytes: 2840 }, findings: 1 },
  usage: {
    available: true,
    coverage: { days: 7, from: '2026-10-26', to: '2026-11-06' },
    sessions: 42,
    totalCalls: 7246,
    tools: [{ name: 'bash', calls: 5395 }, { name: 'read', calls: 536 }],
  },
  assets: {
    sources: [{ id: 'config.patch', label: '用户配置 patch', exists: true, size: 18432 }],
    findings: [{ id: 'orphan:example', severity: 'warn', title: '孤儿配置行', detail: 'example 在运行时不存在' }],
    counts: { error: 0, warn: 1, info: 0 },
  },
};

const states = new Map();
const effects = [];
let cursor = 0;
let current = null;
let dirty = false;

const React = {
  useState(initial) {
    const list = states.get(current.fn) ?? [];
    states.set(current.fn, list);
    const index = cursor++;
    if (!(index in list)) list[index] = typeof initial === 'function' ? initial() : initial;
    return [list[index], (value) => {
      list[index] = typeof value === 'function' ? value(list[index]) : value;
      dirty = true;
    }];
  },
  useEffect(fn) { effects.push(fn); },
  useCallback(fn) { return fn; },
  useMemo(fn) { return fn(); },
  useRef(value) { return { current: value }; },
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.flat(Infinity) } };
  },
};

const requests = [];
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), method: options.method ?? 'GET' });
  return { ok: true, status: 200, json: async () => payload };
};

let captured;
globalThis.window = { __ModuleLoader__: { load({ factory }) { captured = factory((name) => (name === 'react' ? React : {})); } } };

const registrations = [];
const dictionaries = {};
const ctx = {
  effect(fn) { if (typeof fn === 'function') fn(); },
  locale: {
    register(_ns, dicts) { Object.assign(dictionaries, dicts); },
    bind: () => (key) => dictionaries.zh?.[key] ?? key,
  },
  slots: {
    inject(_name, fn) { fn(); },
    register(slot, component) { registrations.push({ slot, component }); return () => {}; },
  },
};

await import('../lib/client.js');
captured.apply(ctx);
const card = registrations.find((entry) => entry.slot.name === 'settings.section')?.component;
assert.ok(card, 'settings.section registered');

function render(node) {
  if (node === null || node === undefined || node === false) return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(render);
  const type = node.type;
  const props = node.props ?? {};
  if (typeof type === 'function') {
    const previous = current;
    current = { fn: type };
    cursor = 0;
    const tree = render(type(props));
    current = previous;
    return tree;
  }
  return { type, props: { ...props, children: (props.children ?? []).map(render) } };
}

const texts = (tree) => {
  if (tree === null || tree === undefined || tree === false) return [];
  if (typeof tree === 'string' || typeof tree === 'number') return [String(tree)];
  if (Array.isArray(tree)) return tree.flatMap(texts);
  return texts(tree.props.children);
};

test('the card renders every section from the payload', async () => {
  let tree;
  for (let round = 0; round < 6; round += 1) {
    dirty = false;
    tree = render({ type: card, props: {} });
    for (const effect of effects.splice(0)) effect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!dirty) break;
  }
  const text = texts(tree).join(' | ');
  for (const label of [
    '只读',
    '可继承配置清单',
    '界面与外观',
    '工具与效率',
    '工作区健康度',
    '79',
    '最常用的是 bash',
    '升级与迁移检查',
    '孤儿配置行',
    'profile 快照与不变量',
    '20261106T075812000',
    'dsh-auth cookie 12 / 2840 B',
    '使用情况',
    '2026-10-26 ~ 2026-11-06',
    '42 会话',
    'bash 5395',
    '用户配置 patch',
  ]) {
    assert.ok(text.includes(label), `missing ${label}`);
  }
  assert.equal(requests.every((request) => request.method === 'GET'), true, 'card must only read');
  assert.ok(requests.some((request) => request.url === '/config-guard/state'));
});
