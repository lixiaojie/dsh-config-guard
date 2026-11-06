// Answers "what do I actually use?" from local evidence only. DSH keeps a
// per-session projection cache that already aggregates tool calls per day
// (`contextActivity.days[date].tools`), so this needs no session replay and no
// zstd decoding: 64 sessions parse in ~40ms. Same idea as dev-horcrux's session
// journal, minus the journal: read the activity the host already recorded.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PREFIXES = ['dsh-', 'tool-', 'multi-root-', 'optional-', 'deepseek-ai-'];

function stripPrefixes(id) {
  let name = id.toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of PREFIXES) {
      if (name.startsWith(prefix)) {
        name = name.slice(prefix.length);
        changed = true;
      }
    }
  }
  return name;
}

/**
 * Maps an observed tool name to the plugin row that provides it.
 * `browser_click` → `dsh-browser-tools` style matches are deliberately loose:
 * a wrong mapping only weakens a suggestion, it never writes anything.
 */
export function pluginForTool(toolName, pluginIds = [], known = {}) {
  const name = String(toolName).toLowerCase();
  if (known[name] !== undefined) return known[name];
  let best = null;
  let bestScore = 0;
  for (const id of pluginIds) {
    const tail = stripPrefixes(String(id));
    if (tail.length === 0) continue;
    if (tail === name) return id;
    if (name.startsWith(tail) || tail.startsWith(name)) {
      const score = Math.min(tail.length, name.length);
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
      continue;
    }
    // `browser_click` belongs to `browser-tools`: compare the first segment.
    const segment = tail.split(/[-_]/)[0];
    if (segment.length >= 4 && name.startsWith(segment)) {
      const score = segment.length;
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
  }
  return bestScore >= 4 ? best : null;
}

function readProjection(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const rows = (parsed.record ?? {}).rows ?? {};
    return {
      identity: rows.identity?.val ?? parsed.record?.identity ?? null,
      activity: rows.contextActivity?.val ?? null,
      model: rows.modelSelection?.val ?? null,
      preset: rows.agentPreset?.val ?? null,
      stats: rows.sessionStats?.val ?? null,
    };
  } catch {
    return null;
  }
}

export const MCP_KNOWN = Object.freeze({
  bash: 'tool-bash',
  pwsh: 'tool-pwsh',
  read: 'tool-read',
  write: 'tool-write',
  edit: 'tool-edit',
  glob: 'tool-glob',
  grep: 'tool-grep',
  skill: 'skill',
  todo_write: 'tool-todo',
  ask_user_question: 'tool-ask-user',
  web_search: 'tool-web-search',
  web_fetch: 'tool-web-fetch',
  present: 'tool-present',
});

/**
 * @param {{ home: string, days?: number, now?: Date, cacheDir?: string }} options
 */
export function collectUsage({ home, days = 30, now = new Date(), cacheDir = null } = {}) {
  const dir = cacheDir ?? join(home, '.dsh/storages/session_projcache/sessions');
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const tools = new Map();
  const perDay = new Map();
  const sessions = [];
  const models = new Map();
  let scanned = 0;
  let parseFailures = 0;

  let names = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return {
      window: { days, from: cutoff, to: now.toISOString().slice(0, 10) },
      available: false,
      scanned: 0,
      sessions: 0,
      totalCalls: 0,
      activeDays: 0,
      tools: [],
      models: [],
      perDay: [],
      note: '没有找到会话活动缓存',
    };
  }

  for (const name of names) {
    const record = readProjection(join(dir, name));
    if (record === null) {
      parseFailures += 1;
      continue;
    }
    scanned += 1;
    const activityDays = record.activity?.days ?? {};
    let sessionCalls = 0;
    for (const [date, info] of Object.entries(activityDays)) {
      if (date < cutoff) continue;
      const dayTools = info?.tools ?? {};
      let dayCalls = 0;
      for (const [tool, stat] of Object.entries(dayTools)) {
        const calls = Number(stat?.n ?? 0);
        if (!Number.isFinite(calls) || calls <= 0) continue;
        const entry = tools.get(tool) ?? { name: tool, calls: 0, last: 0, sessions: new Set() };
        entry.calls += calls;
        entry.last = Math.max(entry.last, Number(stat?.last ?? 0));
        entry.sessions.add(name);
        tools.set(tool, entry);
        dayCalls += calls;
        sessionCalls += calls;
      }
      const day = perDay.get(date) ?? { date, calls: 0, sessions: new Set() };
      day.calls += dayCalls;
      day.sessions.add(name);
      perDay.set(date, day);
    }
    if (sessionCalls > 0) {
      sessions.push({
        id: name.replace(/\.json$/, ''),
        calls: sessionCalls,
        cwd: record.identity?.cwd ?? null,
        createdAt: record.identity?.createdAt ?? null,
      });
    }
    const model = record.model?.lastUsed;
    if (model?.model !== undefined) {
      const key = `${model.provider ?? '?'}/${model.model}`;
      models.set(key, (models.get(key) ?? 0) + 1);
    }
  }

  const toolList = [...tools.values()]
    .map((entry) => ({ name: entry.name, calls: entry.calls, last: entry.last, sessions: entry.sessions.size }))
    .sort((left, right) => right.calls - left.calls);

  const observedDays = [...perDay.keys()].sort();
  return {
    window: { days, from: cutoff, to: now.toISOString().slice(0, 10) },
    coverage: {
      days: observedDays.length,
      from: observedDays[0] ?? null,
      to: observedDays.at(-1) ?? null,
    },
    available: true,
    scanned,
    parseFailures,
    sessions: sessions.length,
    totalCalls: toolList.reduce((sum, entry) => sum + entry.calls, 0),
    activeDays: perDay.size,
    tools: toolList,
    models: [...models.entries()].map(([name, count]) => ({ name, sessions: count })).sort((left, right) => right.sessions - left.sessions),
    perDay: [...perDay.values()].map((day) => ({ date: day.date, calls: day.calls, sessions: day.sessions.size })).sort((left, right) => left.date.localeCompare(right.date)),
    recentSessions: sessions.sort((left, right) => right.calls - left.calls).slice(0, 10),
  };
}

export function usageSummary(usage) {
  if (usage === null || usage?.available !== true) return { calls: 0, tools: 0, sessions: 0, activeDays: 0 };
  return {
    calls: usage.totalCalls,
    tools: usage.tools.length,
    sessions: usage.sessions,
    activeDays: usage.activeDays,
  };
}
