// ── detail panel (issue #90): README / version history / deps / install ──

/** 详情面板 props（PluginManagerView 的 detail* 状态 + 动作）。 */
interface PluginDetailPanelProps {
  name: string | null
  detail: any
  loading: boolean
  error: string | boolean | null
  version: string | null
  onClose: () => void
  onVersionChange: (version: string) => void
  install: (source: string) => void
  installing: string | null
}

/** 详情头部 props。 */
interface DetailHeadProps {
  name: string | null
  onClose: () => void
}

/** 详情主体 props（loading → error → body 三态）。 */
interface DetailBodyProps {
  detail: any
  loading: boolean
  error: string | boolean | null
  version: string | null
  onVersionChange: (version: string) => void
  install: (source: string) => void
  installing: string | null
}

/** 元数据工具栏 props。 */
interface DetailMetaProps {
  detail: any
  version: string | null
  onVersionChange: (version: string) => void
  install: (source: string) => void
  installing: string | null
}

/** 通用区块 props。 */
interface DetailSectionProps {
  title: string
  body: unknown
}

/** README 预览 props。 */
interface ReadmeViewProps {
  text: string
}

/** 版本时间线 props。 */
interface DetailTimelineProps {
  versions: any
}

/** 依赖表 props。 */
interface DetailDepsProps {
  dependencies: any
  peerDependencies: any
}

function PluginDetailPanel({
  name,
  detail,
  loading,
  error,
  version,
  onClose,
  onVersionChange,
  install,
  installing,
}: PluginDetailPanelProps) {
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-detail' },
    createElement(DetailHead, { name, onClose }),
    renderDetail({ detail, loading, error, version, onVersionChange, install, installing }),
  )
}

function DetailHead({ name, onClose }: DetailHeadProps) {
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-detail-head' },
    createElement('span', { className: 'dsh-my-plugin-manager-detail-title' }, name ?? ''),
    createElement(
      'button',
      { className: 'dsh-my-plugin-manager-btn dsh-my-plugin-manager-btn-ghost', onClick: onClose },
      strings.close(),
    ),
  )
}

/** Loading → error → detail-body switch. */
function renderDetail({ detail, loading, error, version, onVersionChange, install, installing }: DetailBodyProps) {
  if (loading) return createElement('div', { className: 'dsh-my-plugin-manager-status' }, strings.loadingDetail())
  if (error !== null && error !== false) {
    const message = typeof error === 'string' ? error : strings.loadError()
    return createElement('div', { className: 'dsh-my-plugin-manager-error' }, `${strings.detailFailed()}：${message}`)
  }
  if (detail === null) return null
  const readmeBody =
    detail.readme === ''
      ? createElement('div', { className: 'dsh-my-plugin-manager-empty' }, strings.noReadme())
      : createElement(ReadmeView, { text: detail.readme })
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-detail-body' },
    createElement(DetailMeta, { detail, version, onVersionChange, install, installing }),
    createElement(DetailSection, { title: strings.readme(), body: readmeBody }),
    createElement(DetailSection, {
      title: strings.versionHistory(),
      body: createElement(DetailTimeline, { versions: detail.versions }),
    }),
    createElement(DetailSection, {
      title: strings.dependencies(),
      body: createElement(DetailDeps, { dependencies: detail.dependencies, peerDependencies: detail.peerDependencies }),
    }),
  )
}

/** Metadata toolbar: version picker + install button + info tags. */
function DetailMeta({ detail, version, onVersionChange, install, installing }: DetailMetaProps) {
  const source = installSource(detail.name, version, detail.latest)
  const installingThis = installing === source
  const versions = Array.isArray(detail.versions) ? detail.versions : []
  const isLatest = version === '' || version === detail.latest
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-detail-meta' },
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-detail-toolbar' },
      createElement(
        'select',
        {
          className: 'dsh-my-plugin-manager-detail-version',
          value: version ?? '',
          onChange: (event) => onVersionChange(event.target.value),
        },
        versions.map((v) => createElement('option', { key: v.version, value: v.version }, v.version)),
      ),
      createElement(
        'button',
        {
          className: 'dsh-my-plugin-manager-btn dsh-my-plugin-manager-btn-primary',
          onClick: () => install(source),
          disabled: installingThis,
        },
        icon.plus(14),
        installingThis ? strings.installing() : isLatest ? strings.installLatest() : strings.installAt(version),
      ),
    ),
    detail.description !== ''
      ? createElement('div', { className: 'dsh-my-plugin-manager-detail-desc' }, detail.description)
      : null,
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-detail-tags' },
      metaTag(detail.author, strings.author()),
      metaTag(detail.license, strings.license()),
      metaTag(detail.downloads > 0 ? String(detail.downloads) : '', strings.downloads()),
      detail.repository !== ''
        ? createElement(
            'a',
            {
              className: 'dsh-my-plugin-manager-detail-tag dsh-my-plugin-manager-detail-tag-link',
              href: detail.repository,
              target: '_blank',
              rel: 'noreferrer',
            },
            strings.repository(),
          )
        : null,
    ),
  )
}

/** A single metadata chip; hidden when the value is empty. */
function metaTag(value: unknown, label: string) {
  if (value === '' || value === null || value === undefined) return null
  return createElement('span', { className: 'dsh-my-plugin-manager-detail-tag' }, `${label}：${value}`)
}

function installSource(name: string, version: string, latest: string): string {
  return version !== '' && version !== latest ? `${name}@${version}` : name
}

function DetailSection({ title, body }: DetailSectionProps) {
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-detail-section' },
    createElement('div', { className: 'dsh-my-plugin-manager-detail-section-title' }, title),
    body,
  )
}

/** README preview: dsh-md-render MarkdownView, falling back to plain <pre>. */
function ReadmeView({ text }: ReadmeViewProps) {
  if (MarkdownView) return createElement(MarkdownView, { text })
  return createElement('pre', { className: 'dsh-my-plugin-manager-readme-plain' }, text)
}

function DetailTimeline({ versions }: DetailTimelineProps) {
  if (!Array.isArray(versions) || versions.length === 0) {
    return createElement('div', { className: 'dsh-my-plugin-manager-empty' }, strings.noVersions())
  }
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-timeline' },
    versions.map((entry, i) =>
      createElement(
        'div',
        { key: `${entry.version}-${i}`, className: 'dsh-my-plugin-manager-timeline-item' },
        createElement('span', { className: 'dsh-my-plugin-manager-timeline-dot' }),
        createElement('span', { className: 'dsh-my-plugin-manager-timeline-version' }, entry.version),
        createElement('span', { className: 'dsh-my-plugin-manager-timeline-date' }, entry.date),
      ),
    ),
  )
}

/** dependencies + peerDependencies tables (peer missing highlighted). */
function DetailDeps({ dependencies, peerDependencies }: DetailDepsProps) {
  const deps = Array.isArray(dependencies) ? dependencies : []
  const peers = Array.isArray(peerDependencies) ? peerDependencies : []
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-deps' },
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-deps-group' },
      createElement('div', { className: 'dsh-my-plugin-manager-deps-label' }, strings.dependencies()),
      deps.length === 0
        ? createElement(
            'div',
            { className: 'dsh-my-plugin-manager-empty dsh-my-plugin-manager-dep-empty' },
            strings.noDependencies(),
          )
        : depRows(deps),
    ),
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-deps-group dsh-my-plugin-manager-deps-peer' },
      createElement('div', { className: 'dsh-my-plugin-manager-deps-label' }, strings.peerDependencies()),
      createElement('div', { className: 'dsh-my-plugin-manager-deps-hint' }, strings.peerHint()),
      peers.length === 0
        ? createElement(
            'div',
            { className: 'dsh-my-plugin-manager-empty dsh-my-plugin-manager-dep-empty' },
            strings.noDependencies(),
          )
        : peerRows(peers),
    ),
  )
}

function depRows(deps: any[]) {
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-dep-table' },
    deps.map((dep) =>
      createElement(
        'div',
        { key: dep.name, className: 'dsh-my-plugin-manager-dep-row' },
        createElement('span', { className: 'dsh-my-plugin-manager-dep-name' }, dep.name),
        createElement('span', { className: 'dsh-my-plugin-manager-dep-spec' }, dep.spec),
      ),
    ),
  )
}

function peerRows(peers: any[]) {
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-dep-table' },
    peers.map((peer) =>
      createElement(
        'div',
        {
          key: peer.name,
          className: `dsh-my-plugin-manager-dep-row${peer.missing ? ' dsh-my-plugin-manager-dep-missing' : ''}`,
        },
        createElement('span', { className: 'dsh-my-plugin-manager-dep-name' }, peer.name),
        createElement('span', { className: 'dsh-my-plugin-manager-dep-spec' }, peer.spec),
        peer.missing
          ? createElement('span', { className: 'dsh-my-plugin-manager-dep-missing-badge' }, strings.missingPeer())
          : null,
      ),
    ),
  )
}
