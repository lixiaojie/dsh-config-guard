// Catalog of every durable user asset this plugin knows about: what DSH keeps
// outside the app, which parts survive an upgrade, and which parts a migration
// has to carry. Pure data + filesystem reads; no host objects, so the catalog
// and the checks are testable outside DSH.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const GROUPS = Object.freeze({
  PLUGINS: 'plugins',
  CONFIG: 'config',
  PREFS: 'prefs',
  SKILLS: 'skills',
  AGENTS: 'agents',
  WORKSPACE: 'workspace',
  SECRETS: 'secrets',
  HISTORY: 'history',
});

export const SEVERITY = Object.freeze({ ERROR: 'error', WARN: 'warn', INFO: 'info' });

const SKIP_ALWAYS = ['node_modules', '.git', '__pycache__', '.DS_Store', '.cache'];

// Build output and tool caches are never worth carrying across machines: they
// are regenerated locally and they are what made skill packs 90MB instead of
// ~5MB. Skills content opts into this list; other assets keep the plain one.
export const BUILD_DIRS = ['dist', 'build', 'target', '.venv', 'venv', '.next', '.turbo', 'coverage', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.idea', '.vscode'];

/**
 * Descriptors are declared as (group, relative path from the user home, rules).
 * `default` decides whether an export includes the asset when the user does not
 * choose anything explicitly; `secret` assets are never bundled without opt-in.
 */
export function catalog({ home, profileName = 'desktop' }) {
  const profile = `.dsh/profiles/${profileName}`;
  const item = (id, label, group, relPath, options = {}) => ({
    id,
    label,
    group,
    relPath,
    path: join(home, relPath),
    type: options.type ?? 'file',
    default: options.default ?? true,
    secret: options.secret ?? false,
    portable: options.portable ?? true,
    optional: options.optional ?? false,
    skip: options.skip ?? SKIP_ALWAYS,
    note: options.note ?? '',
  });

  return [
    item('profile.manifest', '插件与 bundle 清单', GROUPS.PLUGINS, `${profile}/package.json`, {
      note: '依赖版本、link 路径、已启用 bundle',
    }),
    item('profile.vendor', '本地插件副本', GROUPS.PLUGINS, `${profile}/vendor`, {
      type: 'dir',
      optional: true,
      note: 'vendor/ 下的本地开发插件（可重装则可跳过）',
    }),
    item('config.patch', '用户配置 patch', GROUPS.CONFIG, `${profile}/cordis.patch.yml`, {
      note: '所有行级设置与 provider 配置',
    }),
    item('config.presets', 'preset 声明覆盖', GROUPS.CONFIG, `${profile}/preset-overrides.json`, {
      optional: true,
    }),
    item('prefs.pet', '宠物/皮肤偏好', GROUPS.PREFS, '.dsh/pet.json', { optional: true }),
    item('prefs.skin', '当前皮肤', GROUPS.PREFS, '.dsh/skin-center-active.json', { optional: true }),
    item('prefs.workspace-combiner', '工作区组合器偏好', GROUPS.PREFS, '.dsh/dsh-workspace-combiner.json', { optional: true }),
    item('prefs.task-board', '任务看板台账', GROUPS.PREFS, '.dsh/task-board', { type: 'dir', optional: true }),
    item('prefs.usage', '用量与费用记录', GROUPS.PREFS, '.dsh/dsh-usage', { type: 'dir', optional: true }),
    item('prefs.subscriptions', '订阅台账', GROUPS.PREFS, '.dsh/subscriptions', { type: 'dir', optional: true }),
    item('prefs.prompt-prediction', '提示词预测事件', GROUPS.PREFS, '.dsh/prompt-prediction', {
      type: 'dir',
      optional: true,
      default: false,
      note: '事件流，体积随使用增长，默认不打包',
    }),
    item('prefs.config-guard', '守卫自身状态', GROUPS.PREFS, '.dsh/config-guard.json', { optional: true }),
    item('prefs.market', '插件市场状态', GROUPS.PREFS, `${profile}/.dsh-market/state.json`, { optional: true }),
    item('prefs.market-pending', '插件市场待处理行', GROUPS.PREFS, `${profile}/.dsh-market/pending-rows.json`, {
      optional: true,
      default: false,
    }),
    item('agents.ledger', '代理台账', GROUPS.AGENTS, '.dsh/dsh-agents/ledger.json', { optional: true }),
    item('skills.lock', '技能安装锁', GROUPS.SKILLS, '.agents/.skill-lock.json', {
      note: '技能来源与版本，迁移后用于重装',
    }),
    item('skills.content', '技能内容', GROUPS.SKILLS, '.agents/skills', {
      type: 'dir',
      default: true,
      optional: true,
      skip: [...SKIP_ALWAYS, ...BUILD_DIRS],
      note: '默认带上（含参考文档/PDF）；可取消「不含技能内容」排除；自动跳过 node_modules/.git/dist/build/.venv 等构建产物',
    }),
    item('workspace.registry', '工作区登记', GROUPS.WORKSPACE, '.dsh/storages/workspace.json', {
      note: '含绝对路径，导入时按重映射规则改写',
    }),
    item('workspace.multi-root', '多根工作区登记', GROUPS.WORKSPACE, '.dsh/storages/multi_root_workspace.json', {
      optional: true,
      note: '含绝对路径，导入时按重映射规则改写',
    }),
    item('secrets.credentials', '凭证', GROUPS.SECRETS, '.dsh/.credentials.yaml', {
      secret: true,
      default: false,
      note: '默认排除；显式勾选会以明文进入迁移包',
    }),
  ];
}

function locate(home, relPath) {
  const absolute = join(home, relPath);
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return { path: absolute, exists: false };
  }
  return { path: absolute, exists: true, size: stat.size, mtime: stat.mtime.toISOString(), directory: stat.isDirectory() };
}

function countTree(path, skip = SKIP_ALWAYS) {
  let files = 0;
  let bytes = 0;
  const walk = (dir, depth) => {
    if (depth > 24) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.includes(entry.name)) continue;
      const child = join(dir, entry.name);
      if (entry.isDirectory()) walk(child, depth + 1);
      else if (entry.isFile()) {
        try {
          files += 1;
          bytes += statSync(child).size;
        } catch {
          // a file can vanish between readdir and stat; ignore it
        }
      }
    }
  };
  try {
    walk(path, 0);
  } catch {
    return { files: 0, bytes: 0 };
  }
  return { files, bytes };
}

/** Presence + size for the card, so the user sees what would travel. */
export function scanSources(sources) {
  return sources.map((source) => {
    const located = locate(join(source.path, '..'), relative(join(source.path, '..'), source.path));
    const base = { ...source };
    if (!located.exists) return { ...base, exists: false };
    const info = { ...base, exists: true, size: located.size ?? 0, mtime: located.mtime };
    if (source.type === 'dir') {
      const counted = countTree(source.path, source.skip ?? SKIP_ALWAYS);
      info.files = counted.files;
      info.size = counted.bytes;
    }
    return info;
  });
}

/** Every absolute path referenced by a YAML document, deduplicated. */
export function absolutePaths(text) {
  const found = new Set();
  const pattern = /(?:\/Users\/|\/home\/|\/root\/)(?:[^\s"':,]+)/g;
  for (const match of text.matchAll(pattern)) found.add(match[0].replace(/[).,;]+$/, ''));
  return [...found];
}

const SECRET_PATTERNS = [
  { kind: 'openai-style', pattern: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { kind: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { kind: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { kind: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._-]{24,}/g },
];

/** Report secret-like matches without ever returning the secret itself. */
export function scanSecrets(text) {
  const matches = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const { kind, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) matches.push({ kind, line: index + 1, length: line.length });
    }
  });
  return matches;
}

export function isLinkSpec(spec) {
  return typeof spec === 'string' && spec.startsWith('link:');
}

export function linkTarget(spec) {
  return isLinkSpec(spec) ? spec.slice('link:'.length) : null;
}

/**
 * Upgrade/portability findings. Inputs are plain data so every rule can be
 * unit-tested: bundles come from `listBundles()`, rows from
 * `configEditor.configuration()`, manifest/patch/registries from disk.
 */
export function upgradeFindings(input) {
  const findings = [];
  const push = (id, severity, group, title, detail) => findings.push({ id, severity, group, title, detail });

  const manifest = input.manifest ?? {};
  const dependencies = manifest.dependencies ?? {};
  const runtimeVersion = input.runtimeVersion ?? null;

  for (const [name, spec] of Object.entries(dependencies)) {
    if (name.startsWith('@deepseek-ai/') && typeof spec === 'string' && /^\d/.test(spec) && runtimeVersion !== null && spec !== runtimeVersion) {
      push(`pin:${name}`, SEVERITY.WARN, GROUPS.PLUGINS, '官方包版本钉住与运行时不一致', `${name}@${spec} ≠ ${runtimeVersion}`);
    }
    if (isLinkSpec(spec)) {
      const raw = linkTarget(spec);
      const target = raw === null ? null : raw.startsWith('/') ? raw : join(input.profileDir ?? input.home ?? '', raw);
      const outsideHome = target !== null && !target.startsWith(input.home ?? '');
      if (outsideHome) {
        push(`link-outside:${name}`, SEVERITY.INFO, GROUPS.PLUGINS, 'link 依赖在 home 之外，迁移后需重定向', `${name} → ${target}`);
      }
      if (target !== null && !existsSync(target)) {
        push(`link-missing:${name}`, SEVERITY.ERROR, GROUPS.PLUGINS, 'link 依赖指向不存在的路径', `${name} → ${raw}`);
      }
    }
  }

  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [];
  const available = new Set((input.availableBundles ?? []).map((bundle) => bundle.name));
  if (available.size > 0) {
    for (const name of bundles) {
      if (!available.has(name)) {
        push(`bundle-missing:${name}`, SEVERITY.ERROR, GROUPS.PLUGINS, 'bundle 已被当前版本移除', `${name} 仍在 profile 里，启动可能失败`);
      }
    }
  }

  const rowIds = new Set((input.configuration ?? []).map((row) => row?.entry?.options?.id).filter(Boolean));
  if (rowIds.size > 0) {
    for (const id of input.patchRowIds ?? []) {
      if (!rowIds.has(id)) push(`orphan:${id}`, SEVERITY.WARN, GROUPS.CONFIG, '孤儿配置行', `patch 里的 ${id} 在运行时不存在`);
    }
  }

  if (Array.isArray(input.patchPaths) && input.patchPaths.length > 0) {
    push('abs-patch', SEVERITY.INFO, GROUPS.CONFIG, '配置里含绝对路径', `${input.patchPaths.length} 处，迁移时按重映射改写`);
  }

  for (const match of input.secretMatches ?? []) {
    push(`secret:${match.kind}`, SEVERITY.ERROR, GROUPS.SECRETS, '配置里疑似含密钥', `${match.kind} 出现在第 ${match.line} 行（值不会出现在报告里）`);
  }

  if (Array.isArray(input.workspacePaths) && input.workspacePaths.length > 0) {
    const missing = input.workspacePaths.filter((path) => !existsSync(path));
    if (missing.length > 0) {
      push('workspace-missing', SEVERITY.INFO, GROUPS.WORKSPACE, '工作区路径在本机不存在', `${missing.length}/${input.workspacePaths.length} 个`);
    }
  }

  const unlocked = (input.skillDirs ?? []).filter((name) => !(input.skillsLock?.skills ?? {})[name]);
  if (unlocked.length > 0) {
    push('skills-unlocked', SEVERITY.INFO, GROUPS.SKILLS, '未登记来源的技能', `${unlocked.length} 个技能不在 .skill-lock.json 里，迁移后无法自动更新`);
  }

  return findings;
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

export function listSkillDirs(skillsRoot) {
  try {
    return readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && entry.name !== '.git')
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
