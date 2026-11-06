// Host-side glue for the asset catalog: turns the pure catalog/checks into the
// payload the settings card shows. Read-only build: no pack endpoints, no
// credential handling, no writes — the module surface is the scan itself.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { catalog, absolutePaths, listSkillDirs, readJson, scanSecrets, scanSources, upgradeFindings } from './sources.js';

export function assetHome() {
  return process.env.HOME ?? process.env.USERPROFILE ?? '/';
}

function textOf(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function workspacePaths(home) {
  const paths = [];
  for (const relPath of ['.dsh/storages/workspace.json', '.dsh/storages/multi_root_workspace.json']) {
    const text = textOf(join(home, relPath));
    if (text.length > 0) paths.push(...absolutePaths(text));
  }
  return [...new Set(paths)];
}

export function collectAssets({ home, profileName, profileDir, runtimeVersion, manifest, configuration, availableBundles }) {
  const sources = catalog({ home, profileName });
  const scanned = scanSources(sources);
  const patchPath = join(profileDir, 'cordis.patch.yml');
  const patchText = textOf(patchPath);
  const findings = upgradeFindings({
    home,
    runtimeVersion,
    manifest,
    availableBundles,
    configuration,
    patchRowIds: [...patchText.matchAll(/^- id: (\S+)\s*$/gm)].map((match) => match[1]),
    patchPaths: absolutePaths(patchText),
    secretMatches: scanSecrets(patchText),
    profileDir,
    workspacePaths: workspacePaths(home),
    skillsLock: readJson(join(home, '.agents/.skill-lock.json')),
    skillDirs: listSkillDirs(join(home, '.agents/skills')),
  });
  const counts = findings.reduce((accumulator, finding) => {
    accumulator[finding.severity] = (accumulator[finding.severity] ?? 0) + 1;
    return accumulator;
  }, { error: 0, warn: 0, info: 0 });
  return {
    sources: scanned.map((source) => ({
      id: source.id,
      label: source.label,
      group: source.group,
      relPath: source.relPath,
      exists: source.exists ?? false,
      size: source.size ?? 0,
      files: source.files ?? 0,
      defaultOn: source.default,
      secret: source.secret,
      note: source.note,
      mtime: source.mtime ?? null,
    })),
    findings,
    counts,
    profileDir,
    workspacePaths: workspacePaths(home),
  };
}
