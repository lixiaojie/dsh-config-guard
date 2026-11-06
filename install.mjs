// Local installer: copies this plugin into a DSH profile, links it into the
// profile's node_modules, registers the dependency and the bundle. Nothing is
// enabled implicitly: the plugin starts in `mode: report` (inspect only).
//
//   node install.mjs --profile desktop [--dry-run]
//   node install.mjs --profile desktop --uninstall
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const NAME = 'dsh-config-guard';
const STAMP = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);

const profileArg = arg('--profile', 'desktop');
const profile = profileArg.includes('/') || profileArg.startsWith('~')
  ? resolve(profileArg.replace(/^~/, homedir()))
  : join(homedir(), '.dsh', 'profiles', profileArg);
const source = resolve(arg('--source', dirname(new URL(import.meta.url).pathname)));
const dryRun = flag('--dry-run');
const uninstall = flag('--uninstall');
const vendor = join(profile, 'vendor', NAME);
const linkPath = join(profile, 'node_modules', NAME);
const manifestFile = join(profile, 'package.json');
const patchFile = join(profile, 'cordis.patch.yml');

if (!existsSync(profile)) {
  console.error(`profile 目录不存在：${profile}`);
  process.exit(1);
}
if (profile === source || source.startsWith(`${profile}/`)) {
  console.error('--source 不能指向 profile 自身');
  process.exit(1);
}

const backup = (file) => {
  if (!existsSync(file)) return undefined;
  const target = `${file}.before-${NAME}-${STAMP}`;
  if (!dryRun) copyFileSync(file, target);
  return target;
};

const report = (line) => console.log(`${dryRun ? '[dry-run] ' : ''}${line}`);

function currentManifest() {
  return JSON.parse(readFileSync(manifestFile, 'utf8'));
}

function withDependency(manifest, enabled) {
  const dependencies = { ...(manifest.dependencies ?? {}) };
  const bundles = [...(((manifest.dsh ?? {}).profile ?? {}).bundles ?? [])];
  if (enabled) {
    dependencies[NAME] = `link:vendor/${NAME}`;
    if (!bundles.includes(NAME)) bundles.push(NAME);
  } else {
    delete dependencies[NAME];
  }
  const nextBundles = enabled ? bundles : bundles.filter((entry) => entry !== NAME);
  return {
    ...manifest,
    dependencies,
    dsh: { ...(manifest.dsh ?? {}), profile: { ...((manifest.dsh ?? {}).profile ?? {}), bundles: [...new Set(nextBundles)] } },
  };
}

if (uninstall) {
  report(`移除 vendored 副本：${vendor}`);
  if (existsSync(vendor) && !dryRun) rmSync(vendor, { recursive: true, force: true });
  if (existsSync(linkPath) || (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink())) {
    report(`移除链接：${linkPath}`);
    if (!dryRun) unlinkSync(linkPath);
  }
  const backupFile = backup(manifestFile);
  if (backupFile) report(`已备份 package.json → ${basename(backupFile)}`);
  const manifest = withDependency(currentManifest(), false);
  if (!dryRun) writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  report('已从 dependencies / dsh.profile.bundles 移除。重启 DSH 生效。');
  process.exit(0);
}

// 1. copy the plugin outside the pnpm store, like the other local plugins.
report(`复制插件：${source} → ${vendor}`);
if (!dryRun) {
  rmSync(vendor, { recursive: true, force: true });
  cpSync(source, vendor, {
    recursive: true,
    filter: (path) => !path.includes('/node_modules') && !path.includes('/.git') && !path.endsWith('.log'),
  });
}

// 2. symlink it into the profile's node_modules.
mkdirSync(join(profile, 'node_modules'), { recursive: true });
if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
  report(`更新已有链接：${linkPath} → ${readlinkSync(linkPath)}`);
  if (!dryRun) unlinkSync(linkPath);
}
report(`建立链接：${linkPath} → ${vendor}`);
if (!dryRun) symlinkSync(vendor, linkPath, 'dir');

// 3. dependency + bundle registration.
const backupFile = backup(manifestFile);
if (backupFile) report(`已备份 package.json → ${basename(backupFile)}`);
const manifest = withDependency(currentManifest(), true);
if (!dryRun) writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
report(`dependencies["${NAME}"] = link:vendor/${NAME}`);
report(`dsh.profile.bundles += ${NAME}`);

// 4. the bundle patch inserts the row; a manual row is only a warning sign.
if (existsSync(patchFile)) {
  const text = readFileSync(patchFile, 'utf8');
  if (text.includes(`id: config-guard`) && !text.includes('dsh-config-guard')) {
    report('警告：cordis.patch.yml 已有 config-guard 行但不是本插件，请人工确认');
  }
}

report('完成。下一步：重启 DSH（或让宿主热加载 profile），然后打开 设置 → 配置继承守卫。');
report(`状态文件：${join(homedir(), '.dsh', 'config-guard.json')}`);
report('默认 mode=report：只检查不写盘；确认清单后再点“补齐”。');
