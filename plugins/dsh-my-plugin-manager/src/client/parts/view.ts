// ── view: Plugin Manager settings tab ─────────────────────────────────
// 只保留官方插件管理**没有**的三块：npm 市场关键词搜索、更新检查、插件详情增强。
// 安装 / 卸载 / 启停 / 清单管理由官方侧边栏插件页（+ tool-plugin-manager）承担，
// 本页不再重复实现——官方刻意让设置页插件列表保持只读。
// npm brand badge for market rows (badgeIcon from the shared icons part):
// brand fill + contrast ink, same family as the FILE_BADGES chips.
const NPM_BADGE = ['#CB3837', '#ffffff', 'npm']

/** createActions 的 setter 依赖（PluginManagerView 的 useState setter）。 */
interface PluginStateSetters {
  setUpdates: (value: OutdatedItem[] | null) => void
  setError: (value: string | boolean) => void
  setChecking: (value: boolean) => void
  setDetailName: (value: string | null) => void
  setDetail: (value: any) => void
  setDetailLoading: (value: boolean) => void
  setDetailError: (value: string | boolean | null) => void
  setDetailVersion: (value: string | null) => void
  detailName: string | null
}

/** createActions 返回的动作集合（全部只读：无安装 / 卸载 / 启停写动作）。 */
interface PluginActions {
  runUpdates: () => void
  openDetail: (name: string) => void
  closeDetail: () => void
  changeDetailVersion: (version: string) => void
}

/** UpdatesSection props。 */
interface UpdatesSectionProps {
  updates: OutdatedItem[] | null
  checking: boolean
  onCheck: () => void
}

/** MarketSection props。 */
interface MarketSectionProps {
  actions: PluginActions
}

/** MarketRow props。 */
interface MarketRowProps {
  item: MarketItem
  onOpen: () => void
}

function createActions({
  setUpdates,
  setError,
  setChecking,
  setDetailName,
  setDetail,
  setDetailLoading,
  setDetailError,
  setDetailVersion,
  detailName,
}: PluginStateSetters): PluginActions {
  const runUpdates = () => {
    setError(false)
    setChecking(true)
    fetchUpdates()
      .then((value) => setUpdates(value.outdated ?? []))
      .catch((error) => setError(error.message ?? true))
      .finally(() => setChecking(false))
  }
  const loadDetail = (name, version) => {
    setDetailName(name)
    setDetailVersion(version)
    setDetailError(null)
    setDetailLoading(true)
    fetchDetail(name, version)
      .then((value) => {
        setDetail(value)
        setDetailVersion(value.version)
        setDetailLoading(false)
      })
      .catch((error) => {
        setDetailError(error.message ?? true)
        setDetailLoading(false)
      })
  }
  const openDetail = (name) => loadDetail(name, '')
  const closeDetail = () => {
    setDetailName(null)
    setDetail(null)
    setDetailVersion(null)
    setDetailError(null)
    setDetailLoading(false)
  }
  const changeDetailVersion = (version) => loadDetail(detailName, version)
  return { runUpdates, openDetail, closeDetail, changeDetailVersion }
}

function usePluginManagerState() {
  const [updates, setUpdates] = useState(null)
  const [error, setError] = useState<string | boolean>(false)
  const [checking, setChecking] = useState(false)
  const [detailName, setDetailName] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)
  const [detailVersion, setDetailVersion] = useState(null)

  const actions = createActions({
    setUpdates,
    setError,
    setChecking,
    setDetailName,
    setDetail,
    setDetailLoading,
    setDetailError,
    setDetailVersion,
    detailName,
  })

  return { updates, error, checking, detailName, detail, detailLoading, detailError, detailVersion, actions }
}

function PluginManagerView() {
  const { updates, error, checking, detailName, detail, detailLoading, detailError, detailVersion, actions } =
    usePluginManagerState()

  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-root' },
    createElement('div', { className: 'dsh-my-plugin-manager-hint' }, strings.scopeHint()),
    error
      ? createElement(
          'div',
          { className: 'dsh-my-plugin-manager-error' },
          typeof error === 'string' ? `${strings.actionFailed()}：${error}` : strings.loadError(),
        )
      : null,
    createElement(UpdatesSection, { updates, checking, onCheck: actions.runUpdates }),
    createElement(MarketSection, { actions }),
    detailName !== null
      ? createElement(PluginDetailPanel, {
          name: detailName,
          detail,
          loading: detailLoading,
          error: detailError,
          version: detailVersion,
          onClose: actions.closeDetail,
          onVersionChange: actions.changeDetailVersion,
        })
      : null,
  )
}

/** 更新检查：点刷新图标跑 `dsh plugin outdated`，逐行列出「当前 → 最新」。 */
function UpdatesSection({ updates, checking, onCheck }: UpdatesSectionProps) {
  const rows =
    updates === null
      ? null
      : updates.length === 0
        ? createElement('div', { className: 'dsh-my-plugin-manager-status' }, strings.noUpdates())
        : updates.map((entry) =>
            createElement(
              'div',
              { key: entry.name, className: 'dsh-my-plugin-manager-row' },
              createElement(
                'div',
                { className: 'dsh-my-plugin-manager-row-head' },
                createElement('span', { className: 'dsh-my-plugin-manager-row-icon' }, icon.file(16)),
                createElement('span', { className: 'dsh-my-plugin-manager-name' }, entry.name),
                createElement(
                  'span',
                  { className: 'dsh-my-plugin-manager-update' },
                  `${entry.current} → ${entry.latest}`,
                ),
              ),
            ),
          )
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-section' },
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-section-head' },
      createElement('span', { className: 'dsh-my-plugin-manager-section-title' }, strings.updates()),
      createElement(
        'span',
        { className: 'dsh-my-plugin-manager-section-head-actions' },
        createElement(
          'button',
          {
            className: 'dsh-my-plugin-manager-iconbtn dsh-my-plugin-manager-iconbtn-xs',
            onClick: onCheck,
            disabled: checking,
            title: strings.checkUpdates(),
            'aria-label': strings.checkUpdates(),
          },
          icon.refresh(14),
        ),
      ),
    ),
    updates === null
      ? createElement('div', { className: 'dsh-my-plugin-manager-status' }, strings.checkUpdatesHint())
      : rows,
    updates !== null && updates.length > 0
      ? createElement(
          'div',
          { className: 'dsh-my-plugin-manager-status dsh-my-plugin-manager-new' },
          strings.updatesAvailable(updates.length),
        )
      : null,
  )
}

/** 市场：npm 关键词搜索 + 详情入口（安装由官方插件页承担）。 */
function MarketSection({ actions }: MarketSectionProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const runSearch = () => {
    if (query.trim() === '') return
    setSearching(true)
    setSearchError(false)
    fetchSearch(query)
      .then((value) => {
        setResults(value.results ?? [])
        setSearching(false)
      })
      .catch(() => {
        setSearching(false)
        setSearchError(true)
      })
  }
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-section' },
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-section-head' },
      createElement('span', { className: 'dsh-my-plugin-manager-section-title' }, strings.market()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-searchbar' },
      createElement('input', {
        className: 'dsh-my-plugin-manager-search-input',
        placeholder: strings.searchPlaceholder(),
        value: query,
        onChange: (event) => setQuery(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter') runSearch()
        },
      }),
      createElement(
        'button',
        {
          className: 'dsh-my-plugin-manager-btn dsh-my-plugin-manager-btn-primary',
          onClick: runSearch,
          disabled: searching,
        },
        icon.search(14),
        strings.search(),
      ),
    ),
    searchError ? createElement('div', { className: 'dsh-my-plugin-manager-error' }, strings.searchFailed()) : null,
    searching
      ? createElement('div', { className: 'dsh-my-plugin-manager-status' }, strings.loading())
      : marketRows(results, actions.openDetail),
  )
}

/** Market rows: placeholder / empty / result list. */
function marketRows(results: MarketItem[] | null, openDetail: (name: string) => void) {
  if (results === null)
    return createElement(
      'div',
      { className: 'dsh-my-plugin-manager-empty' },
      icon.search(18),
      strings.emptySearch(),
      createElement('span', { className: 'dsh-my-plugin-manager-empty-hint' }, strings.emptySearchHint()),
    )
  if (results.length === 0)
    return createElement(
      'div',
      { className: 'dsh-my-plugin-manager-empty' },
      icon.search(18),
      strings.noResults(),
      createElement('span', { className: 'dsh-my-plugin-manager-empty-hint' }, strings.noResultsHint()),
    )
  return results.map((item) => createElement(MarketRow, { key: item.name, item, onOpen: () => openDetail(item.name) }))
}

/** One market search result row: npm badge / name / version chip + detail. */
function MarketRow({ item, onOpen }: MarketRowProps) {
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-row' },
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-row-head' },
      createElement('span', { className: 'dsh-my-plugin-manager-row-icon' }, badgeIcon(NPM_BADGE, 16)),
      createElement(
        'button',
        { className: 'dsh-my-plugin-manager-name dsh-my-plugin-manager-name-btn', onClick: onOpen },
        item.name,
      ),
      createElement('span', { className: 'dsh-my-plugin-manager-ver' }, `v${item.version}`),
      item.author !== '' ? createElement('span', { className: 'dsh-my-plugin-manager-author' }, item.author) : null,
    ),
    createElement('div', { className: 'dsh-my-plugin-manager-desc' }, item.description),
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-actions' },
      createElement('button', { className: 'dsh-my-plugin-manager-btn', onClick: onOpen }, strings.details()),
    ),
  )
}
