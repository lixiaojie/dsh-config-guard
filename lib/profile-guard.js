// Profile invariants: keep a rolling snapshot of the two files whose silent
// loss costs the most — `package.json` (the bundle roster) and
// `cordis.patch.yml` (every local override) — plus the `preset-overrides.json`
// that preset rows are rebuilt from, and diff the live profile against the
// newest *previous* snapshot on every check.
//
// Why this exists (2026-11-06 incident): the desktop crash-recovery button
// renames `cordis.patch.yml` to a `.bak` but rewrites `package.json` through
// `writeProfileBundles()` with no backup, so a recovery round can drop the
// whole bundle list with nothing to restore from. The patch layer has a
// backup; the roster does not. This module supplies the missing one, and
// reports the collapse instead of letting it look like a normal start.
//
// Read-only build: the profile is never written, and this module does not
// create snapshots either. It reads the snapshots that the full build leaves in
// `$DSH_HOME/config-guard/snapshots/<stamp>/` (if any) and diffs the live
// profile against the newest previous one, so the history-based checks still
// work for anyone who used the full version first.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const WATCHED_FILES = ['package.json', 'cordis.patch.yml', 'preset-overrides.json'];
export const SEVERITY = { ERROR: 'error', WARN: 'warn', INFO: 'info' };

const COOKIE_MAX_AGE_WARN_DAYS = 7;
const COOKIE_WARN_COUNT = 40;
const COOKIE_ERROR_COUNT = 60;
const COOKIE_ERROR_BYTES = 12288;

/** @param {string} value @returns {string} */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * @param {string} file
 * @returns {string | null} file text, or null when it is absent or unreadable
 */
function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Bundle roster in manifest order, tolerating a manifest that is not JSON.
 * @param {string | null} text
 * @returns {string[]}
 */
export function bundlesOf(text) {
  if (text === null) return [];
  try {
    const manifest = JSON.parse(text);
    const bundles = manifest?.dsh?.profile?.bundles;
    return Array.isArray(bundles) ? bundles.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Read the `connection` row out of the patch layer without a YAML dependency.
 * The row is a top-level list item, so it starts at column 0 with `- id:` and
 * ends at the next line that does.
 * @param {string | null} patchText
 * @returns {{ present: boolean, cookieMaxAgeDays: number | null }}
 */
export function connectionRow(patchText) {
  if (patchText === null) return { present: false, cookieMaxAgeDays: null };
  const lines = patchText.split('\n');
  const start = lines.findIndex((line) => /^-\s+id:\s*['"]?connection['"]?\s*$/.test(line));
  if (start < 0) return { present: false, cookieMaxAgeDays: null };
  let cookieMaxAgeDays = null;
  for (const line of lines.slice(start + 1)) {
    if (/^-\s+id:/.test(line)) break;
    const match = /^\s+cookieMaxAgeDays:\s*(\d+)\s*$/.exec(line);
    if (match !== null) cookieMaxAgeDays = Number(match[1]);
  }
  return { present: true, cookieMaxAgeDays };
}

/**
 * Current profile state, without writing anything.
 * @param {string} profileDir
 * @returns {{ files: Record<string, { size: number, sha256: string } | null>, bundles: string[], patchBytes: number, connection: { present: boolean, cookieMaxAgeDays: number | null } }}
 */
export function readProfileState(profileDir) {
  const files = {};
  const parts = [];
  for (const name of WATCHED_FILES) {
    const text = readText(join(profileDir, name));
    if (text === null) {
      files[name] = null;
      continue;
    }
    files[name] = { size: Buffer.byteLength(text), sha256: sha256(text) };
    parts.push(`${name}\u0000${files[name].sha256}`);
  }
  const patchText = files['cordis.patch.yml'] === null ? null : readText(join(profileDir, 'cordis.patch.yml'));
  return {
    files,
    bundles: bundlesOf(files['package.json'] === null ? null : readText(join(profileDir, 'package.json'))),
    patchBytes: files['cordis.patch.yml']?.size ?? 0,
    connection: connectionRow(patchText),
  };
}

/** @param {Record<string, { size: number, sha256: string } | null>} files */
function digestOf(files) {
  return sha256(WATCHED_FILES.map((name) => `${name}\u0000${files[name]?.sha256 ?? 'absent'}`).join('\n'));
}

/**
 * Snapshot directories, newest first.
 * @param {string} store
 * @returns {Array<{ stamp: string, dir: string, manifest: object }>}
 */
export function listSnapshots(store) {
  let entries;
  try {
    entries = readdirSync(store, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{8}T\d{6}\d{3}$/.test(entry.name)) continue;
    const dir = join(store, entry.name);
    const text = readText(join(dir, 'manifest.json'));
    if (text === null) continue;
    try {
      found.push({ stamp: entry.name, dir, manifest: JSON.parse(text) });
    } catch {
      // a half-written snapshot is ignored rather than trusted
    }
  }
  return found.sort((left, right) => (left.stamp < right.stamp ? 1 : left.stamp > right.stamp ? -1 : 0));
}

/** @param {Date} date */
function stampOf(date) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad(date.getMilliseconds(), 3)}`;
}

/**
 * Compare two profile states and describe what an operator would otherwise
 * have to notice by hand.
 * @param {object | null} previous snapshot manifest
 * @param {ReturnType<typeof readProfileState>} current
 * @returns {Array<{ id: string, severity: string, group: string, title: string, detail: string }>}
 */
export function diffProfile(previous, current) {
  const findings = [];
  if (previous === null || typeof previous !== 'object') {
    findings.push({
      id: 'profile:first-snapshot',
      severity: SEVERITY.INFO,
      group: 'profile',
      title: '已建立首个 profile 快照',
      detail: '此后每次启动都会对比 bundle 列表与 patch 体量；丢失时会在这里报出而不是静默启动。',
    });
    return findings;
  }
  const before = Array.isArray(previous.bundles) ? previous.bundles : [];
  const missing = before.filter((name) => !current.bundles.includes(name));
  if (missing.length > 0) {
    findings.push({
      id: 'profile:bundles-lost',
      severity: SEVERITY.ERROR,
      group: 'profile',
      title: 'bundle 列表比上次快照少了条目',
      detail: `${missing.length} 个（${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}）—— package.json 的 bundle 列表在写入时不落备份，这是崩溃恢复后「插件全丢」的成因。`,
    });
  }
  const beforeBytes = Number(previous.patchBytes ?? 0);
  if (beforeBytes > 1024 && current.patchBytes < beforeBytes * 0.6) {
    findings.push({
      id: 'profile:patch-collapsed',
      severity: SEVERITY.ERROR,
      group: 'profile',
      title: 'patch 层比上次快照明显变小',
      detail: `${beforeBytes} → ${current.patchBytes} B（${Math.round((current.patchBytes / beforeBytes) * 100)}%）—— 崩溃恢复的「禁用第三方插件」会把 patch 重写成空模板，快照目录里留有原件。`,
    });
  }
  if (!current.connection.present) {
    findings.push({
      id: 'profile:connection-missing',
      severity: SEVERITY.WARN,
      group: 'profile',
      title: 'patch 层没有 connection 行',
      detail: '该行用于收敛 dsh-auth cookie 寿命；缺失时回落到 30 天默认值，桌面端每次重启都会新增一枚同名族 cookie。',
    });
  } else if (current.connection.cookieMaxAgeDays === null) {
    findings.push({
      id: 'profile:cookie-lifetime-unset',
      severity: SEVERITY.WARN,
      group: 'profile',
      title: 'connection 行未设置 cookieMaxAgeDays',
      detail: '按 schema 默认 30 天计算；按每天 3–15 次重启，约 5–23 天会撞上 16 KiB 头限制（HTTP 431）。',
    });
  } else if (current.connection.cookieMaxAgeDays > COOKIE_MAX_AGE_WARN_DAYS) {
    findings.push({
      id: 'profile:cookie-lifetime-long',
      severity: SEVERITY.WARN,
      group: 'profile',
      title: `dsh-auth cookie 寿命 ${current.connection.cookieMaxAgeDays} 天`,
      detail: '寿命越长，同一 127.0.0.1 上的旧端口 cookie 累积越多；实测建议 ≤ 3 天，否则由上游在签发时退役旧名。',
    });
  }
  return findings;
}

/**
 * Locate the desktop cookie jar for this platform.
 * @param {string} home user home directory
 * @param {string} platform
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function cookieJarPath(home, platform = process.platform, env = process.env) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', '@deepseek-ai', 'dsh-desktop', 'Cookies');
  if (platform === 'win32') {
    const appData = env.APPDATA;
    return appData === undefined || appData === '' ? null : join(appData, '@deepseek-ai', 'dsh-desktop', 'Cookies');
  }
  if (platform === 'linux') return join(home, '.config', '@deepseek-ai', 'dsh-desktop', 'Cookies');
  return null;
}

const cookieCache = new Map();

/**
 * Count `dsh-auth-*` cookies without touching the live jar. Electron owns the
 * database while the app runs, so this is a single read-only aggregate query
 * with a short timeout; any failure is reported as unavailable, never thrown.
 * @param {string} home
 * @param {{ ttlMs?: number, platform?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {{ available: boolean, db: string | null, count: number, bytes: number } | null}
 */
export function countAuthCookies(home, options = {}) {
  const db = cookieJarPath(home, options.platform, options.env ?? process.env);
  if (db === null || !existsSync(db)) return null;
  const ttl = options.ttlMs ?? 300000;
  const cached = cookieCache.get(db);
  if (cached !== undefined && Date.now() - cached.at < ttl) return cached.value;
  let value = { available: false, db, count: 0, bytes: 0 };
  try {
    const out = execFileSync(
      'sqlite3',
      [db, "SELECT COUNT(*), COALESCE(SUM(LENGTH(name)+LENGTH(value)+2),0) FROM cookies WHERE name LIKE 'dsh-auth-%';"],
      { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const [count, bytes] = out.trim().split('|').map((part) => Number(part));
    if (Number.isFinite(count) && Number.isFinite(bytes)) value = { available: true, db, count, bytes };
  } catch {
    // sqlite3 missing, or the jar is locked mid-flush: report unavailable
  }
  cookieCache.set(db, { at: Date.now(), value });
  return value;
}

/**
 * One check: snapshot when asked, then describe drift and cookie budget.
 * @param {{ home: string, profileDir: string, write?: boolean, now?: Date, platform?: string, env?: Record<string, string | undefined>, cookieTtlMs?: number }} input
 * @returns {{ store: string, snapshots: number, latest: object | null, written: boolean, findings: object[], cookieJar: object | null }}
 */
export function collectProfileGuard(input) {
  const home = input.home;
  const profileDir = input.profileDir;
  const store = join(home, '.dsh', 'config-guard', 'snapshots');
  if (typeof profileDir !== 'string' || profileDir === '' || !existsSync(join(profileDir, 'package.json'))) {
    return { store, snapshots: 0, latest: null, written: false, findings: [], cookieJar: null };
  }
  const state = readProfileState(profileDir);
  const previous = listSnapshots(store)[0] ?? null;
  const findings = diffProfile(previous?.manifest ?? null, state);
  const snapshots = listSnapshots(store);
  const cookieJar = countAuthCookies(home, { platform: input.platform, env: input.env, ttlMs: input.cookieTtlMs });
  if (cookieJar?.available === true) {
    if (cookieJar.bytes >= COOKIE_ERROR_BYTES || cookieJar.count >= COOKIE_ERROR_COUNT) {
      findings.push({
        id: 'profile:cookie-jar-near-limit',
        severity: SEVERITY.ERROR,
        group: 'profile',
        title: 'dsh-auth cookie 罐接近 16 KiB 头限制',
        detail: `${cookieJar.count} 条 / ${cookieJar.bytes} B。再启动几次就会 431；退出 DSH 后清理 dsh-auth cookie（或缩短 connection 行的 cookieMaxAgeDays）。`,
      });
    } else if (cookieJar.count >= COOKIE_WARN_COUNT) {
      findings.push({
        id: 'profile:cookie-jar-growing',
        severity: SEVERITY.WARN,
        group: 'profile',
        title: 'dsh-auth cookie 条数偏多',
        detail: `${cookieJar.count} 条 / ${cookieJar.bytes} B。寿命收敛后应稳定在「每天重启次数 × 寿命天数」。`,
      });
    }
  }
  const latest = snapshots[0] ?? null;
  return {
    store,
    snapshots: snapshots.length,
    latest: latest === null ? null : { stamp: latest.stamp, at: latest.manifest?.at ?? null, patchBytes: latest.manifest?.patchBytes ?? null, bundles: Array.isArray(latest.manifest?.bundles) ? latest.manifest.bundles.length : 0 },
    written: false,
    findings,
    cookieJar,
  };
}

/** Filesystem-safe summary line for logs/trace. */
export function describeProfileGuard(result) {
  const latest = result.latest === null ? 'none' : `${result.latest.stamp} (${result.latest.patchBytes} B, ${result.latest.bundles} bundles)`;
  const cookie = result.cookieJar?.available === true ? `${result.cookieJar.count} cookies / ${result.cookieJar.bytes} B` : 'jar n/a';
  return `profile-guard snapshots=${result.snapshots} latest=${latest} findings=${result.findings.length} ${cookie}`;
}
