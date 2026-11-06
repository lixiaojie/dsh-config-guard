// Pure inspection logic: turns native `configEditor.configuration()` rows and
// declared preset overrides into an inheritance inventory plus the minimal
// edits that would restore inheritance. No I/O, no host objects beyond plain
// data, so the same code is unit-testable outside DSH.

export const STATUS = Object.freeze({
  INHERITED: 'inherited',
  BLOCKED: 'blocked',
  PINNED: 'pinned',
  CUSTOM: 'custom',
});

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const sameValue = (left, right) => JSON.stringify(sortValue(left)) === JSON.stringify(sortValue(right));

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

/**
 * Apply declared overrides to the freshly inherited preset plugin list.
 * `declared` maps a preset plugin row id to either a bare config object or a
 * `{ config, disabled, name }` override, matching preset-overrides.json.
 */
export function applyPresetDeclarations(inheritedPlugins, declared = {}) {
  const rows = (Array.isArray(inheritedPlugins) ? inheritedPlugins : []).map((row) => ({
    ...row,
    ...(isPlainObject(row.config) ? { config: { ...row.config } } : {}),
  }));
  const declaredIds = Object.keys(declared ?? {});
  for (const id of declaredIds) {
    const decl = declared[id];
    const override = isPlainObject(decl) ? decl : {};
    const config = isPlainObject(override.config)
      ? override.config
      : isPlainObject(decl)
        ? decl
        : undefined;
    const target = rows.find((row) => row !== null && typeof row === 'object' && row.id === id);
    if (target === undefined) {
      const created = { id, ...(typeof override.name === 'string' ? { name: override.name } : {}) };
      if (config !== undefined) created.config = { ...config };
      if (override.disabled !== undefined) created.disabled = override.disabled;
      rows.push(created);
      continue;
    }
    if (typeof override.name === 'string') target.name = override.name;
    if (override.disabled !== undefined) target.disabled = override.disabled;
    if (config !== undefined) target.config = { ...(isPlainObject(target.config) ? target.config : {}), ...config };
  }
  return rows;
}

/** Compare a preset's persisted plugin list with the declared expectation. */
export function presetDrift(inheritedPlugins, persistedPlugins, declared) {
  const expected = applyPresetDeclarations(inheritedPlugins, declared);
  const expectedById = new Map(expected.map((row) => [row.id, row]));
  const persistedById = new Map(
    (Array.isArray(persistedPlugins) ? persistedPlugins : [])
      .filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string')
      .map((row) => [row.id, row]),
  );
  const missingIds = [...expectedById.keys()].filter((id) => !persistedById.has(id));
  const extraIds = [...persistedById.keys()].filter((id) => !expectedById.has(id));
  const changedRows = [];
  for (const [id, row] of expectedById) {
    const persisted = persistedById.get(id);
    if (persisted === undefined) continue;
    if (!sameValue(row.config ?? {}, persisted.config ?? {}) || !sameValue(row.disabled, persisted.disabled)) {
      changedRows.push(id);
    }
  }
  return {
    expected,
    plugins: expected.length,
    missingIds,
    extraIds,
    changedRows,
    stale: missingIds.length > 0 || extraIds.length > 0 || changedRows.length > 0,
  };
}

/**
 * Build the inheritance inventory.
 * @param configuration `ctx.configEditor.configuration()` rows.
 * @param options.disabled row ids whose automatic inheritance is switched off.
 * @param options.presets declared per-preset plugin overrides.
 */
export function summarize(configuration, options = {}) {
  const disabled = new Set(Array.isArray(options.disabled) ? options.disabled : []);
  const disableAll = options.disableAll === true;
  const presets = isPlainObject(options.presets) ? options.presets : {};
  const items = [];

  for (const row of Array.isArray(configuration) ? configuration : []) {
    const entry = row?.entry;
    const id = entry?.options?.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    const inherited = isPlainObject(row.inherited) ? row.inherited : {};
    const override = isPlainObject(row.override) ? row.override : {};
    const inheritedKeys = Object.keys(inherited);
    const overrideKeys = Object.keys(override);
    const name = typeof entry?.options?.name === 'string' ? entry.options.name : undefined;
    const item = {
      id,
      name,
      inheritedKeys,
      overrideKeys,
      missingKeys: [],
      disabled: disableAll || disabled.has(id),
      status: STATUS.INHERITED,
    };

    if (overrideKeys.length === 0) {
      items.push(item);
      continue;
    }
    if (inheritedKeys.length === 0) {
      item.status = STATUS.CUSTOM;
      items.push(item);
      continue;
    }

    item.missingKeys = inheritedKeys.filter((key) => !(key in override));
    item.status = item.missingKeys.length > 0 ? STATUS.BLOCKED : STATUS.PINNED;

    if (Array.isArray(inherited.plugins) && Array.isArray(override.plugins)) {
      const drift = presetDrift(inherited.plugins, override.plugins, presets[id] ?? presets?.[(override.id ?? inherited.id)]);
      item.preset = {
        plugins: drift.plugins,
        declaredRows: Object.keys(presets[id] ?? presets?.[(override.id ?? inherited.id)] ?? {}).length,
        stale: drift.stale,
        missingIds: drift.missingIds,
        extraIds: drift.extraIds,
        changedRows: drift.changedRows,
      };
      if (drift.stale && item.status === STATUS.PINNED) item.status = STATUS.BLOCKED;
    }
    items.push(item);
  }

  const counts = { total: items.length, inherited: 0, pinned: 0, blocked: 0, custom: 0 };
  for (const item of items) counts[item.status] += 1;
  return { items, counts };
}

/**
 * Plan the minimal edits that restore inheritance. Only rows that are not
 * disabled and that actually drifted produce an edit.
 */
export function planEdits(configuration, options = {}) {
  const declared = isPlainObject(options.presets) ? options.presets : {};
  const { items } = summarize(configuration, options);
  const edits = [];
  for (const item of items) {
    if (item.disabled) continue;
    if (item.status !== STATUS.BLOCKED) continue;
    const row = (Array.isArray(configuration) ? configuration : []).find(
      (candidate) => candidate?.entry?.options?.id === item.id,
    );
    if (row === undefined) continue;
    const inherited = isPlainObject(row.inherited) ? row.inherited : {};
    const override = isPlainObject(row.override) ? row.override : {};
    if (item.preset !== undefined) {
      const presetId = override.id ?? inherited.id ?? item.id;
      const expected = applyPresetDeclarations(inherited.plugins, declared[item.id] ?? declared[presetId] ?? {});
      edits.push({
        kind: 'preset',
        id: item.id,
        entry: row.entry,
        restoredKeys: [],
        next: { ...inherited, ...override, plugins: expected },
        detail: {
          missingIds: item.preset.missingIds,
          extraIds: item.preset.extraIds,
          changedRows: item.preset.changedRows,
        },
      });
      continue;
    }
    edits.push({
      kind: 'merge',
      id: item.id,
      entry: row.entry,
      restoredKeys: item.missingKeys,
      next: { ...inherited, ...override },
    });
  }
  return edits;
}

/** Human-readable one-liner used by the settings card and the report. */
export function describeItem(item) {
  switch (item.status) {
    case STATUS.BLOCKED:
      return item.preset !== undefined
        ? `preset 落后：缺 ${item.preset.missingIds.length} 行，改 ${item.preset.changedRows.length} 行`
        : `缺 ${item.missingKeys.length} 个继承键：${item.missingKeys.join(', ')}`;
    case STATUS.PINNED:
      return '当前键集完整；升级新增键会被覆盖吞掉';
    case STATUS.CUSTOM:
      return '第三方行，不参与继承';
    default:
      return '完全继承';
  }
}
