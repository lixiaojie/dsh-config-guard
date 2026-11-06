// Turns findings + inventory into a workspace health check: a score, and a
// short list of suggestions. This build is read-only, so every suggestion is
// advice only: the `action` field stays null and no host-side write is
// advertised — offering a button that cannot act would be worse than no button.
import { statSync } from 'node:fs';
import { MCP_KNOWN, pluginForTool } from './usage.js';

export const SEVERITY = Object.freeze({ high: 'high', medium: 'medium', low: 'low' });

const WEIGHT = { high: 18, medium: 7, low: 2 };

function bytesOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function fmt(size) {
  if (size >= 1e9) return `${(size / 1e9).toFixed(1)}GB`;
  if (size >= 1e6) return `${Math.round(size / 1e6)}MB`;
  if (size >= 1e3) return `${Math.round(size / 1e3)}KB`;
  return `${size}B`;
}

const TEXT = {
  orphan: (id) => ({
    title: `删除孤立的配置行 ${id}`,
    detail: '这一行在 patch 里，但当前版本已经没有对应插件；留着只会在升级时制造噪音，建议删除。',
  }),
  'bundle-missing': (id) => ({
    title: `移除已下线的 bundle ${id}`,
    detail: 'profile 的 bundles 仍引用它，升级后可能导致启动失败。',
  }),
  'link-missing': (id) => ({
    title: `修正失效的 link 依赖 ${id}`,
    detail: 'link 指向的目录已不存在，重装该插件或删除这行依赖。',
  }),
  pin: (id) => ({
    title: `放开被钉住的官方包 ${id}`,
    detail: '版本钉住与当前运行时不一致，升级后会一直报冲突；除非有意固定，建议跟随运行时。',
  }),
  'link-outside': () => ({
    title: 'link 依赖指向 home 之外',
    detail: '迁移到别的机器时这些路径不会跟着走；把插件放进 profile/vendor 或改成相对路径。',
  }),
  'abs-patch': () => ({
    title: '清理配置里的绝对路径',
    detail: '迁移时导入会按重映射改写，但本机使用时建议换成相对路径或环境变量，减少换机成本。',
  }),
  'workspace-missing': () => ({
    title: '有工作区路径在本机不存在',
    detail: '打开工作区会报错；确认是否已移动目录，或从工作区登记里移除。',
  }),
  'skills-unlocked': (detail) => ({
    title: '把手工安装的技能登记进锁文件',
    detail: `${detail}：未登记就迁移，新机器上无法按锁重装，只能靠搬运整包内容。`,
  }),
  secret: () => ({
    title: '配置里疑似有明文密钥',
    detail: '把密钥挪到凭证文件，迁移时用「包含凭证（加密）」携带，不要留在 patch 里。',
  }),
};

function adviceFor(finding) {
  const [kind, target] = String(finding.id).split(/:(.*)/s);
  const build = TEXT[kind];
  const text = typeof build === 'function' ? build(target ?? finding.title) : null;
  return text ?? { title: finding.title, detail: finding.detail ?? '' };
}

/**
 * @param {{ items?: any[], findings?: any[], sources?: any[], packs?: any[] }} input
 */
export function buildSuggestions({ items = [], findings = [], sources = [], packs = [], usage = null, pluginIds = [] } = {}) {
  const suggestions = [];
  const add = (suggestion) => suggestions.push({ id: suggestion.id, severity: suggestion.severity, ...suggestion });

  for (const finding of findings) {
    const severity = finding.severity === 'error' ? SEVERITY.high : finding.severity === 'warn' ? SEVERITY.medium : SEVERITY.low;
    const text = adviceFor(finding);
    // Read-only build: an orphan row is reported with its remediation text, but
    // no machine-readable action is offered.
    const action = null;
    add({
      id: `fix:${finding.id}`,
      severity,
      group: finding.group,
      title: text.title,
      detail: text.detail,
      action,
    });
  }

  // Upgrade conflicts: the inheritance tab already knows how to restore them.
  const blocked = items.filter((item) => item.status === 'blocked');
  const pinned = items.filter((item) => item.status === 'pinned');
  if (blocked.length > 0) {
    add({
      id: 'fix:blocked-rows',
      severity: SEVERITY.high,
      group: 'config',
      title: `有 ${blocked.length} 行配置与继承值冲突`,
      detail: '这些行会在升级时挡住新默认值；在「继承」页签点应用即可恢复继承。',
      action: null,
    });
  }
  if (pinned.length > 0) {
    add({
      id: 'fix:pinned-rows',
      severity: SEVERITY.low,
      group: 'config',
      title: `有 ${pinned.length} 行是自定义值`,
      detail: '确认这些是你有意改的；其余可交回继承。',
      action: null,
    });
  }

  // Housekeeping: old packs and heavy assets.
  const oldPacks = packs.filter((pack) => typeof pack.path === 'string');
  const packBytes = oldPacks.reduce((sum, pack) => sum + bytesOf(pack.path), 0);
  if (oldPacks.length > 3) {
    add({
      id: 'clean:packs',
      severity: SEVERITY.low,
      group: 'packs',
      title: `迁移包已积累 ${oldPacks.length} 个（${fmt(packBytes)}）`,
      detail: '删除过期的包，只保留需要跨设备使用的那一个。',
      action: null,
    });
  }
  const heavy = sources.filter((source) => (source.size ?? 0) > 5e6 && source.defaultOn === true).sort((a, b) => b.size - a.size);
  for (const source of heavy.slice(0, 2)) {
    add({
      id: `trim:${source.id}`,
      severity: SEVERITY.low,
      group: source.group,
      title: `${source.label} 占 ${fmt(source.size)}`,
      detail:
        source.id === 'skills.content'
          ? '确实需要就随包走；只想要结构时勾「不含技能内容」，包会回到几十 KB。'
          : '体积较大，确认是否真的需要随迁移包携带。',
      action: null,
    });
  }

  // Usage: what the local session activity actually shows, not what is installed.
  if (usage !== null && usage?.available === true) {
    const calls = new Map(usage.tools.map((tool) => [tool.name, tool.calls]));
    // Only rows whose tool entry point we actually know can be called unused;
    // a plugin id does not reveal everything it exposes, and a false "unused"
    // claim would push someone to delete a working plugin.
    const observed = usage.tools.map((tool) => tool.name);
    const idle = [];
    for (const id of Object.values(MCP_KNOWN)) {
      if (!pluginIds.includes(id)) continue;
      const used = observed.some((name) => pluginForTool(name, [id]) === id);
      if (!used) idle.push(id);
    }
    const span = usage.coverage?.days > 0 ? `${usage.coverage.from} ~ ${usage.coverage.to}，${usage.coverage.days} 天` : `近 ${usage.window.days} 天`;
    if (idle.length > 0 && usage.totalCalls > 0) {
      add({
        id: 'usage:idle-tools',
        severity: SEVERITY.low,
        group: 'usage',
        title: `活动数据（${span}）里 ${idle.length} 个已知工具入口没有调用记录`,
        detail: `${idle.join('、')}——这些插件暴露的工具名可以确定，确实没用过的话移除能少一条升级路径。其余插件入口未知，不做判断。`,
        action: null,
      });
    }
    if ((calls.get('skill') ?? 0) === 0) {
      add({
        id: 'usage:skills-idle',
        severity: SEVERITY.low,
        group: 'usage',
        title: `活动数据里没有技能调用记录`,
        detail: '技能内容和索引仍在迁移包里占体积；如果本来就不常用，迁移时可以勾「不含技能内容」。',
        action: null,
      });
    }
    const shells = ['bash', 'pwsh'].filter((name) => (calls.get(name) ?? 0) > 0);
    if (shells.length > 1) {
      add({
        id: 'usage:shell-dupes',
        severity: SEVERITY.low,
        group: 'usage',
        title: `同时在用 ${shells.join(' 和 ')}`,
        detail: '两个终端工具的能力高度重合，留一个能少一条升级路径。',
        action: null,
      });
    }
    const top = usage.tools[0];
    if (top !== undefined && usage.totalCalls > 100) {
      add({
        id: 'usage:top-tool',
        severity: SEVERITY.low,
        group: 'usage',
        title: `最常用的是 ${top.name}（${top.calls} 次）`,
        detail: `${span}：共 ${usage.totalCalls} 次工具调用、${usage.sessions} 个活跃会话、${usage.activeDays} 个活跃日。`,
        action: null,
      });
    }
  }

  suggestions.sort((left, right) => WEIGHT[right.severity] - WEIGHT[left.severity]);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const suggestion of suggestions) counts[suggestion.severity] += 1;
  const score = Math.max(0, Math.min(100, 100 - counts.high * WEIGHT.high - counts.medium * WEIGHT.medium - counts.low * WEIGHT.low));
  const level = score >= 90 ? 'healthy' : score >= 70 ? 'attention' : 'action';
  return { health: { score, level, counts }, suggestions };
}
