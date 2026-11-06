// Client half (read-only build): the "配置继承" settings card. Loaded by the
// app's client module loader for the bundle `dsh-config-guard`; no build step,
// like the other local plugins. Every control is a read: one GET refresh.
window.__ModuleLoader__.load({
  id: 'dsh-config-guard',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');
    const h = React.createElement;
    const PKG = 'dsh-config-guard';
    const NS = 'config-guard';

    const zh = {
      title: '配置继承守卫（只读）',
      hint: '只读：不写配置、不落状态、不导出凭证。列出 profile 覆盖了哪些行、升级会丢掉什么、工作区多大、工具用得多不多。',
      readOnly: '只读',
      degraded: '缺少 configEditor，仅显示资产与用量',
      reload: '重新读取',
      loading: '正在读取…',
      failed: '读取失败',
      itemHeader: '可继承配置清单',
      blocked: '需补齐',
      pinned: '已钉住',
      custom: '第三方行',
      inherited: '完全继承',
      missingKeys: '缺',
      compatHeader: '兼容性检查',
      plugins: '插件',
      bundles: 'Bundles',
      upgrade: '检测到升级',
      healthHeader: '工作区健康度',
      healthHealthy: '健康',
      healthAttention: '需关注',
      healthAction: '建议处理',
      scoreLabel: '分',
      suggestionsHeader: '建议（仅文字）',
      noSuggestion: '没有需要处理的建议',
      profileHeader: 'profile 快照与不变量',
      profileSnapshots: '历史快照',
      profileCookie: 'dsh-auth cookie',
      profileNoStore: '没有历史快照：本版不写快照，只有静态不变量检查',
      findingsHeader: '升级与迁移检查',
      noFindings: '没有发现问题',
      assetsHeader: '可迁移资产',
      profileHeader: 'profile 快照与不变量',
      profileNone: '本版不写快照；有历史快照时会与最新一份对比',
      profileCookie: 'dsh-auth cookie',
      usageHeader: '使用情况',
      usageWindow: '近 30 天',
      usageLine: '会话',
      calls: '次调用',
      checkedAt: '最近读取',
      noItems: '没有可读取的配置行',
      categories: '按用途分类',
      all: '全部',
    };
    const en = {
      title: 'Config inheritance guard (read-only)',
      hint: 'Read-only: no config writes, no state file, no credential export. Shows which rows the profile overrides, what an upgrade would drop, how big the workspace is, and which tools you use.',
      readOnly: 'read-only',
      degraded: 'configEditor missing — assets and usage only',
      reload: 'Refresh',
      loading: 'Loading…',
      failed: 'Failed to load',
      itemHeader: 'Inheritance inventory',
      blocked: 'needs restore',
      pinned: 'pinned',
      custom: 'third-party',
      inherited: 'inherited',
      missingKeys: 'missing',
      compatHeader: 'Compatibility',
      plugins: 'plugins',
      bundles: 'bundles',
      upgrade: 'upgrade detected',
      healthHeader: 'Workspace health',
      healthHealthy: 'healthy',
      healthAttention: 'attention',
      healthAction: 'action needed',
      scoreLabel: 'pts',
      suggestionsHeader: 'Advice (text only)',
      noSuggestion: 'nothing to do',
      profileHeader: 'Profile snapshots & invariants',
      profileSnapshots: 'snapshots',
      profileCookie: 'dsh-auth cookies',
      profileNoStore: 'No snapshots on disk: this build writes none, so only static invariants run',
      findingsHeader: 'Upgrade & migration checks',
      noFindings: 'no findings',
      assetsHeader: 'Portable assets',
      profileHeader: 'Profile snapshots & invariants',
      profileNone: 'This build writes no snapshots; existing ones are still diffed',
      profileCookie: 'dsh-auth cookies',
      usageHeader: 'Usage',
      usageWindow: 'last 30 days',
      usageLine: 'sessions',
      calls: 'calls',
      checkedAt: 'read at',
      noItems: 'no configuration rows to read',
      categories: 'by purpose',
      all: 'all',
    };
    let t = (key) => (zh[key] === undefined ? key : zh[key]);
    let activeLang = 'zh';
    const setT = (fn) => {
      if (typeof fn !== 'function') return;
      t = fn;
      activeLang = String(fn('readOnly') ?? '').startsWith('read-only') ? 'en' : 'zh';
    };
    // Category labels arrive as { zh, en }: pick the active language instead of
    // letting a raw object reach the DOM.
    const labelOf = (entry) => (activeLang === 'en' ? entry?.label?.en : entry?.label?.zh) ?? entry?.id ?? '';

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px', lineHeight: 1.5 },
      head: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' },
      title: { fontSize: '14px', fontWeight: 600 },
      hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      bar: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      button: { font: 'inherit', padding: '4px 12px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', cursor: 'pointer' },
      section: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '10px 12px' },
      sectionHead: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
      sectionTitle: { fontWeight: 600, flex: 1 },
      group: { display: 'flex', flexDirection: 'column' },
      row: { display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0', borderTop: '1px solid var(--dsw-alias-border-l3, transparent)' },
      id: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11.5px', minWidth: '220px' },
      name: { color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))', fontSize: '11px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      desc: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11.5px', flex: 2 },
      badge: { fontSize: '11px', padding: '1px 8px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-l2)', whiteSpace: 'nowrap' },
      badgeWarn: { borderColor: 'var(--dsw-alias-state-warning-primary, #b8860b)', color: 'var(--dsw-alias-state-warning-primary, #b8860b)' },
      badgeOk: { borderColor: 'var(--dsw-alias-state-success-primary, #2e7d32)', color: 'var(--dsw-alias-state-success-primary, #2e7d32)' },
      meta: { color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))', fontSize: '11px' },
      error: { color: 'var(--dsw-alias-state-error-primary, #d33)', fontSize: '12px' },
    };

    function badgeOf(item) {
      if (item.status === 'blocked') return { label: t('blocked'), style: { ...styles.badge, ...styles.badgeWarn } };
      if (item.status === 'pinned') return { label: t('pinned'), style: styles.badge };
      if (item.status === 'custom') return { label: t('custom'), style: styles.meta };
      return { label: t('inherited'), style: { ...styles.badge, ...styles.badgeOk } };
    }

    function Row({ id, name, desc, badge, meta }) {
      return h('div', { style: styles.row },
        h('span', { style: styles.id }, id),
        name ? h('span', { style: styles.name }, name) : null,
        desc ? h('span', { style: styles.desc }, desc) : null,
        meta ? h('span', { style: styles.meta }, meta) : null,
        badge ? h('span', { style: badge.style }, badge.label) : null,
      );
    }

    function Section({ title, meta, children }) {
      return h('div', { style: styles.section },
        h('div', { style: styles.sectionHead },
          h('span', { style: styles.sectionTitle }, title),
          meta ? h('span', { style: styles.meta }, meta) : null,
        ),
        children,
      );
    }

    function GuardCard() {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [status, setStatus] = React.useState('loading');
      const [category, setCategory] = React.useState('all');

      const load = React.useCallback(async () => {
        setStatus('loading');
        setError('');
        try {
          const response = await fetch('/config-guard/state', { headers: { accept: 'application/json' } });
          const payload = await response.json();
          if (!payload.ok) throw new Error(payload?.error?.message || 'request failed');
          setData(payload);
          setStatus('idle');
        } catch (failure) {
          setError(String(failure && failure.message ? failure.message : failure));
          setStatus('error');
        }
      }, []);

      React.useEffect(() => { void load(); }, [load]);

      if (status === 'loading' && data === null) return h('div', { style: styles.meta }, t('loading'));
      if (error) return h('div', { style: styles.error }, `${t('failed')}: ${error}`);

      const items = data?.items ?? [];
      const categories = data?.categories ?? [];
      const filtered = category === 'all' ? items : items.filter((item) => item.category === category);
      const health = data?.health ?? {};
      const level = health.level ?? 'healthy';
      const healthLabel = level === 'healthy' ? t('healthHealthy') : level === 'attention' ? t('healthAttention') : t('healthAction');
      const healthColor = level === 'healthy' ? 'var(--dsw-alias-state-success-primary, #2e7d32)' : level === 'attention' ? 'var(--dsw-alias-state-warning-primary, #b8860b)' : 'var(--dsw-alias-state-error-primary, #d33)';
      const findings = data?.assets?.findings ?? [];
      const sources = data?.assets?.sources ?? [];
      const usage = data?.usage ?? {};

      return h('div', { style: styles.root },
        h('div', { style: styles.head },
          h('span', { style: styles.title }, t('title')),
          h('span', { style: { ...styles.badge, ...styles.badgeOk } }, t('readOnly')),
          data?.degraded ? h('span', { style: { ...styles.badge, ...styles.badgeWarn } }, t('degraded')) : null,
          h('span', { style: styles.meta },
            [data?.runtime?.version ? `DSH ${data.runtime.version}` : null,
              data?.checkedAt ? `${t('checkedAt')} ${String(data.checkedAt).slice(11, 19)}` : null].filter(Boolean).join(' · ')),
          h('button', { type: 'button', style: styles.button, onClick: () => { void load(); } }, t('reload')),
        ),
        h('div', { style: styles.hint }, t('hint')),

        h(Section, {
          title: t('itemHeader'),
          meta: `${filtered.length}/${items.length}${data?.counts?.blocked ? ` · ${t('blocked')} ${data.counts.blocked}` : ''}`,
        },
          h('div', { style: styles.bar },
            h('span', { style: styles.meta }, t('categories')),
            h('button', { type: 'button', style: { ...styles.button, ...(category === 'all' ? styles.badgeOk : {}) }, onClick: () => setCategory('all') }, t('all')),
            categories.slice(0, 10).map((entry) =>
              h('button', {
                key: entry.id,
                type: 'button',
                style: { ...styles.button, ...(category === entry.id ? styles.badgeOk : {}) },
                onClick: () => setCategory(entry.id),
              }, labelOf(entry))),
          ),
          filtered.length === 0
            ? h('div', { style: styles.meta }, t('noItems'))
            : h('div', { style: styles.group }, filtered.map((item) =>
                h(Row, {
                  key: item.id,
                  id: item.id,
                  name: item.name || '',
                  desc: item.description || '',
                  badge: badgeOf(item),
                  meta: (item.missingKeys ?? []).length > 0 ? `${t('missingKeys')} ${item.missingKeys.join(', ')}` : '',
                }))),
        ),

        h(Section, {
          title: t('healthHeader'),
          meta: `${health.score ?? 100} ${t('scoreLabel')} · ${healthLabel} · ${health.counts?.high ?? 0}/${health.counts?.medium ?? 0}/${health.counts?.low ?? 0}`,
        },
          h('div', { style: { ...styles.badge, borderColor: healthColor, color: healthColor, alignSelf: 'flex-start' } }, healthLabel),
          (data?.suggestions ?? []).length === 0
            ? h('div', { style: styles.meta }, t('noSuggestion'))
            : h('div', { style: styles.group }, (data?.suggestions ?? []).map((suggestion) =>
                h(Row, { key: suggestion.id, id: suggestion.id, desc: `${suggestion.title} — ${suggestion.detail}`, badge: { label: suggestion.severity, style: styles.badge } }))),
        ),

        h(Section, {
          title: t('findingsHeader'),
          meta: `${data?.assets?.counts?.error ?? 0} error · ${data?.assets?.counts?.warn ?? 0} warn · ${data?.assets?.counts?.info ?? 0} info`,
        },
          findings.length === 0
            ? h('div', { style: styles.meta }, t('noFindings'))
            : h('div', { style: styles.group }, findings.map((finding, index) =>
                h(Row, {
                  key: `${finding.id}-${index}`,
                  id: finding.id,
                  desc: `${finding.title} — ${finding.detail}`,
                  badge: { label: finding.severity, style: finding.severity === 'error' ? { ...styles.badge, ...styles.badgeWarn } : styles.badge },
                }))),
        ),

        h(Section, {
          title: t('profileHeader'),
          meta: data?.profileGuard?.snapshots > 0
            ? `${data.profileGuard.snapshots} · ${data.profileGuard.latest?.stamp ?? ''}`
            : t('profileNone'),
        },
          h('div', { style: styles.meta },
            data?.profileGuard?.cookieJar
              ? `${t('profileCookie')} ${data.profileGuard.cookieJar.count} / ${data.profileGuard.cookieJar.bytes} B`
              : `${t('profileCookie')} —`),
          (data?.profileGuard?.findings ?? 0) > 0
            ? h('div', { style: styles.meta }, `${t('findingsHeader')} ${data.profileGuard.findings}`)
            : null,
        ),

        h(Section, { title: t('assetsHeader'), meta: `${sources.length}` },
          h('div', { style: styles.group }, sources.slice(0, 20).map((source) =>
            h(Row, {
              key: source.id,
              id: source.relPath || source.id,
              name: source.label,
              desc: source.exists ? `${Math.round((source.size ?? 0) / 1024)} KB` : t('noItems'),
            }))),
        ),

        h(Section, {
          title: `${t('usageHeader')} · ${usage?.coverage?.days > 0 ? `${usage.coverage.from} ~ ${usage.coverage.to}` : t('usageWindow')}`,
          meta: usage?.available === true
            ? `${usage.sessions ?? 0} ${t('usageLine')} · ${usage.totalCalls ?? 0} ${t('calls')}`
            : (usage?.note ?? '—'),
        },
          h('div', { style: styles.bar }, (usage?.tools ?? []).slice(0, 8).map((tool) =>
            h('span', { key: tool.name, style: styles.badge }, `${tool.name} ${tool.calls}`))),
        ),
      );
    }

    const inject = ['slots', 'locale'];

    function applyClient(ctx) {
      if (!ctx.slots || typeof ctx.slots.inject !== 'function') return;
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'config-guard: dictionaries');
        setT(ctx.locale.bind(NS));
      }
      const cardInject = () => ({});
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PKG,
        locale: NS,
        inject: cardInject,
      }, GuardCard));
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'config-guard',
        order: 56,
        locale: NS,
        label: () => t('title'),
        inject: cardInject,
      }, GuardCard));
    }

    module.exports = { name: PKG, inject, apply: applyClient };
    return module.exports;
  },
});
