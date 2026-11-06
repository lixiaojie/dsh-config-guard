// Purpose-based grouping for the inheritance inventory. The inventory is the
// full merged configuration (265 rows on this machine), so browsing needs a
// coarser layer than raw ids: these categories answer "what is this row for".
// Matching is prefix-first on the plugin id, then a few segment keywords, so
// `optional-terminal-bash` and `multi-root-skills` still land somewhere useful.
export const CATEGORIES = Object.freeze([
  { id: 'appearance', order: 1, label: { zh: '界面与外观', en: 'Appearance' }, prefixes: ['ui-', 'skin-', 'theme-', 'layout-', 'font-', 'icon-', 'pet-', 'locale', 'entry-customization', 'message-feedback'] },
  { id: 'tools', order: 2, label: { zh: '工具与效率', en: 'Tools' }, prefixes: ['tool-', 'tools', 'subprocess', 'persistent-terminal', 'bash', 'pwsh', 'shell', 'terminal', 'file-', 'fs-', 'editor-', 'search-', 'clipboard-', 'commands', 'command-', 'shortcuts', 'open-in-app', 'image-', 'office', 'directory-picker'] },
  { id: 'models', order: 3, label: { zh: '模型与推理', en: 'Models' }, prefixes: ['model-', 'provider-', 'llm', 'prompt-', 'preset-', 'completion-', 'embedding-', 'token', 'deepseek-', 'anthropic', 'ptc'] },
  { id: 'sessions', order: 4, label: { zh: '会话与工作区', en: 'Sessions' }, prefixes: ['session-', 'workspace-', 'project-', 'storage-', 'multi-root', 'worktree', 'working-', 'directory', 'compaction', 'history-', 'attachment-', 'spill'] },
  { id: 'automation', order: 5, label: { zh: '自动化与任务', en: 'Automation' }, prefixes: ['task-', 'goal', 'plan', 'auto-', 'schedule-', 'cron-', 'workflow-', 'agent', 'subagent', 'job', 'jobs', 'repeat-', 'ralph', 'timer', 'queue'] },
  { id: 'integrations', order: 6, label: { zh: '集成与连接', en: 'Integrations' }, prefixes: ['mcp-', 'web', 'http-', 'api-', 'net-', 'relay-', 'git-', 'browser-', 'proxy-', 'im-', 'remote', 'connection', 'webserver', 'open-'] },
  { id: 'skills', order: 7, label: { zh: '技能与知识', en: 'Skills' }, prefixes: ['skill', 'skills-', 'knowledge-', 'memory-', 'rag-', 'doc-'] },
  { id: 'usage', order: 8, label: { zh: '统计与用量', en: 'Usage' }, prefixes: ['usage-', 'stats-', 'metrics-', 'telemetry-', 'billing-', 'cost-', 'log-', 'otel', 'dsh-usage', 'dsh-subscriptions'], contains: ['telemetry', 'analytics'] },
  { id: 'security', order: 9, label: { zh: '安全与凭证', en: 'Security' }, prefixes: ['secret-', 'credential', 'auth', 'approval', 'permission-', 'sandbox-', 'policy-', 'fs-observation', 'authorization'], contains: ['sandbox', 'permission', 'approval'] },
  { id: 'kernel', order: 10, label: { zh: '系统与内核', en: 'Kernel' }, prefixes: ['config-', 'cordis-', 'dsh-', 'harness-', 'hmr', 'plugin', 'modules', 'system', 'experimental-', 'settings', 'typert', 'user', 'account-', 'desktop-', 'resources', 'timeout', 'optional-'], contains: ['hmr'] },
]);

export const OTHER = Object.freeze({ id: 'other', order: 99, label: { zh: '其他', en: 'Other' }, prefixes: [] });

function score(category, name) {
  let best = 0;
  for (const prefix of category.prefixes) {
    const bare = prefix.endsWith('-') ? prefix.slice(0, -1) : prefix;
    if ((name.startsWith(prefix) || name === bare) && prefix.length > best) best = prefix.length;
  }
  if (Array.isArray(category.contains)) {
    for (const word of category.contains) {
      if (name.includes(word) && word.length + 1 > best) best = word.length + 1;
    }
  }
  return best;
}

export function categoryOf(id) {
  const raw = typeof id === 'string' ? id.toLowerCase() : '';
  // `optional-*` rows are opt-in variants of the row they wrap: classify by the
  // wrapped id so the category reflects the capability, not the packaging.
  const name = raw.startsWith('optional-') ? raw.slice('optional-'.length) : raw;
  // Longest matching prefix wins, so `fs-observation-policy` lands in security
  // even though `fs-` also looks like a tools prefix.
  let winner = null;
  let winnerScore = 0;
  for (const category of CATEGORIES) {
    const value = score(category, name);
    if (value > winnerScore) {
      winner = category.id;
      winnerScore = value;
    }
  }
  return winner ?? OTHER.id;
}

export function categoryList() {
  return [...CATEGORIES, OTHER].map((category) => ({ id: category.id, order: category.order, label: category.label }));
}

export function groupItems(items) {
  const groups = new Map(categoryList().map((category) => [category.id, { ...category, items: [] }]));
  for (const item of items ?? []) {
    const id = item.category ?? categoryOf(item.id);
    const bucket = groups.get(id) ?? groups.get(OTHER.id);
    bucket.items.push(item);
  }
  return [...groups.values()]
    .filter((group) => group.items.length > 0)
    .sort((left, right) => left.order - right.order);
}
