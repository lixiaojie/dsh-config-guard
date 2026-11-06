// Host half of the read-only build: reads the native inheritance layers
// (`configEditor.configuration()`), reports what an upgrade would silently
// drop, and exposes two GET endpoints for the settings card.
//
// Read-only is a property of this build, not a config flag: there is no state
// file, no edit call, no migration endpoint and no filesystem write anywhere in
// `lib/`. A host without `configEditor` degrades to asset/usage reporting
// instead of failing to activate.
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describeItem, summarize } from './inspect.js';
import { registerRoutes } from './routes.js';
import { assetHome, collectAssets } from './assets.js';
import { categoryList, categoryOf } from './categories.js';
import { buildSuggestions } from './suggest.js';
import { collectUsage } from './usage.js';
import { collectProfileGuard, describeProfileGuard } from './profile-guard.js';

// `@deepseek-ai/schemastery` resolves inside a DSH host, but not when the
// module is loaded by plain `node --test`; Config is metadata only, so a tiny
// chainable shim keeps the module importable in both places.
async function loadSchema() {
  try {
    const module = await import('@deepseek-ai/schemastery');
    return module.default ?? module;
  } catch {
    const shim = () => {
      const api = {};
      for (const method of ['default', 'required', 'description', 'volatile', 'array', 'any', 'number', 'boolean', 'string', 'record', 'dict']) {
        api[method] = () => api;
      }
      return api;
    };
    return { object: (shape) => shape, string: shim, boolean: shim, array: shim, any: shim, number: shim, const: shim, union: shim };
  }
}

const z = await loadSchema();

export const name = 'config-guard';
export const inject = ['pluginManager', 'webServer', 'appReady'];

export const Config = z.object({
  enabled: z.boolean().default(true).description('关闭后插件完全不动作（不检查、不响应卡片）'),
  home: z.string().default('').description('DSH home 覆盖（默认取进程 HOME），仅供测试使用'),
  checkOnStartup: z.boolean().default(true).description('宿主就绪后自动收集一次（只读）'),
  checkIntervalMinutes: z.number().default(1440).description('常驻复查间隔（分钟），0 表示只在启动和手动时收集'),
});

const iso = () => new Date().toISOString();

function profileDirOf(ctx) {
  try {
    return typeof ctx.profileContext?.dir === 'string' ? ctx.profileContext.dir : undefined;
  } catch {
    return undefined;
  }
}

/** `configEditor` is optional in this build: the card still renders without it. */
function editorOf(ctx) {
  try {
    if (typeof ctx.get === 'function') {
      const viaGet = ctx.get('configEditor');
      if (viaGet !== undefined && viaGet !== null) return viaGet;
    }
  } catch {
    // a host without the service throws here; degrade instead
  }
  return ctx.configEditor;
}

async function runtimeInfo(ctx) {
  const info = { profile: profileDirOf(ctx), version: undefined };
  try {
    const bundles = await ctx.pluginManager.listBundles();
    const official = (Array.isArray(bundles) ? bundles : []).find(
      (bundle) => typeof bundle?.name === 'string' && bundle.name.startsWith('@deepseek-ai/dsh-base'),
    );
    if (typeof official?.version === 'string') info.version = official.version;
  } catch {
    // listBundles is optional in older hosts
  }
  info.version ??= process.env.DSH_VERSION;
  return info;
}

function readManifest(ctx) {
  const dir = profileDirOf(ctx);
  if (dir === undefined) return undefined;
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

/** Bundle inventory the card shows; the host may not expose it at all. */
async function bundleInfo(ctx) {
  const empty = { active: [], available: [], inactive: [] };
  try {
    const bundles = await ctx.pluginManager.listBundles();
    const list = (Array.isArray(bundles) ? bundles : []).map((bundle) => ({
      name: bundle?.name,
      version: bundle?.version,
      active: bundle?.active !== false,
    }));
    const active = list.filter((bundle) => bundle.active).map((bundle) => bundle.name).filter((entry) => typeof entry === 'string');
    const available = list.map((bundle) => bundle.name).filter((entry) => typeof entry === 'string');
    return { active, available, inactive: available.filter((entry) => !active.includes(entry)) };
  } catch {
    return empty;
  }
}

/**
 * One read-only inventory pass. Never writes.
 * @returns {Promise<object>} the payload served by GET /config-guard/state
 */
async function collect(ctx, resolved) {
  const homeDir = typeof resolved.home === 'string' && resolved.home.length > 0 ? resolved.home : assetHome();
  const editor = editorOf(ctx);
  const degraded = editor === undefined || editor === null || typeof editor.configuration !== 'function';
  const configuration = degraded ? [] : editor.configuration();
  const { items, counts } = summarize(configuration, { disabled: [], disableAll: false, presets: {} });
  const runtime = await runtimeInfo(ctx);
  const bundles = await bundleInfo(ctx);
  const manifest = readManifest(ctx);
  const profileDir = profileDirOf(ctx) ?? '';
  const assets = collectAssets({
    home: homeDir,
    profileName: basename(profileDir),
    profileDir,
    runtimeVersion: runtime.version,
    manifest,
    configuration,
    availableBundles: bundles.available,
  });
  const usage = collectUsage({ home: homeDir, days: 30 });
  const advice = buildSuggestions({
    items,
    findings: assets.findings,
    sources: assets.sources,
    packs: [],
    usage,
    pluginIds: items.map((item) => item.id),
  });
  return {
    ok: true,
    readOnly: true,
    degraded,
    degradedReason: degraded ? 'configEditor is not available in this host; asset and usage reporting only' : null,
    runtime,
    bundles,
    upgrade: { previousVersion: null, currentVersion: runtime.version ?? null, changed: false },
    mode: 'report',
    items: items.map((item) => ({ ...item, category: categoryOf(item.id), description: describeItem(item) })),
    counts,
    compat: { runtimeVersion: runtime.version ?? null, bundles },
    assets,
    health: advice.health,
    // Advice carries no runnable step in this build; the card renders text only.
    suggestions: (advice.suggestions ?? []).map((suggestion) => ({ ...suggestion, action: null })),
    usage,
    categories: categoryList(),
    state: { disabled: [], last: null, history: [] },
    checkedAt: iso(),
    reason: 'manual',
  };
}

/**
 * Activate the read-only card: register the two GET routes and, when asked,
 * collect once after the host is ready and on the configured interval.
 */
export async function apply(ctx, config) {
  const resolved = {
    enabled: config?.enabled !== false,
    home: typeof config?.home === 'string' ? config.home : '',
    checkOnStartup: config?.checkOnStartup !== false,
    checkIntervalMinutes: typeof config?.checkIntervalMinutes === 'number' ? config.checkIntervalMinutes : 1440,
  };
  if (!resolved.enabled) return;

  const state = async (reason) => ({ ...(await collect(ctx, resolved)), reason });
  registerRoutes(ctx, {
    state: () => state('manual'),
    assets: async () => ({ ok: true, readOnly: true, assets: (await collect(ctx, resolved)).assets }),
  });

  if (resolved.checkOnStartup) {
    const run = () => {
      void state('startup').catch(() => {});
    };
    if (ctx.appReady !== undefined && typeof ctx.appReady.onReady === 'function') ctx.appReady.onReady(run);
  }
  if (resolved.checkIntervalMinutes > 0 && typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const timer = setInterval(() => {
        void state('interval').catch(() => {});
      }, resolved.checkIntervalMinutes * 60000);
      if (typeof timer?.unref === 'function') timer.unref();
      return () => clearInterval(timer);
    });
  }
}
