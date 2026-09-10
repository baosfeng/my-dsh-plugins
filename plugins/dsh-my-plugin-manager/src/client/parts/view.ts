// ── view: Plugin Manager settings tab ──────────────────────────────────
// npm brand badge for market rows (badgeIcon from the shared icons part):
// brand fill + contrast ink, same family as the FILE_BADGES chips.
const NPM_BADGE = ['#CB3837', '#ffffff', 'npm']

/** 列表动作的 setter 依赖（PluginManagerView 的 useState setter）。 */
interface ListActionSetters {
  setInstalled: (value: InstalledEntry[] | null) => void
  setUpdates: (value: OutdatedItem[] | null) => void
  setNotice: (value: string) => void
  setError: (value: string | boolean) => void
  setInstalling: (value: string | null) => void
  setUninstalling: (value: string | null) => void
}

/** 详情动作的 setter 依赖。 */
interface DetailActionSetters {
  setDetailName: (value: string | null) => void
  setDetail: (value: any) => void
  setDetailLoading: (value: boolean) => void
  setDetailError: (value: string | boolean | null) => void
  setDetailVersion: (value: string | null) => void
  detailName: string | null
}

/** createActions 的全部依赖。 */
interface PluginActionSetters extends ListActionSetters, DetailActionSetters {}

/** createActions 返回的动作集合。 */
interface PluginActions {
  reloadInstalled: () => void
  runUpdates: () => void
  install: (source: string) => void
  uninstall: (name: string) => void
  openDetail: (name: string) => void
  closeDetail: () => void
  changeDetailVersion: (version: string) => void
}

/** InstalledSection props。 */
interface InstalledSectionProps {
  installed: InstalledEntry[] | null
  updates: OutdatedItem[] | null
  actions: PluginActions
  uninstalling: string | null
}

/** InstalledRow props（uninstalling 为「本行正在卸载」）。 */
interface InstalledRowProps {
  entry: InstalledEntry
  outdated: OutdatedItem | null
  onOpen: () => void
  onUninstall: () => void
  uninstalling: boolean
}

/** MarketSection props。 */
interface MarketSectionProps {
  actions: PluginActions
  installing: string | null
}

/** MarketRow props（installing 为「本行正在安装」）。 */
interface MarketRowProps {
  item: MarketItem
  onOpen: () => void
  onInstall: () => void
  installing: boolean
}

function createActions(props: PluginActionSetters): PluginActions {
  return { ...createListActions(props), ...createDetailActions(props) }
}

function createListActions({
  setInstalled,
  setUpdates,
  setNotice,
  setError,
  setInstalling,
  setUninstalling,
}: ListActionSetters) {
  const reloadInstalled = () => {
    fetchInstalled()
      .then((value) => setInstalled(value.entries ?? []))
      .catch(() => setError(true))
  }
  const runUpdates = () => {
    setError(false)
    fetchUpdates()
      .then((value) => setUpdates(value.outdated ?? []))
      .catch(() => setError(true))
  }
  const afterWrite = (message) => {
    setNotice(message)
    reloadInstalled()
  }
  const install = (source) => {
    setError(false)
    setInstalling(source)
    postInstall(source)
      .then(() => afterWrite(strings.installDone()))
      .catch((error) => setError(error.message ?? true))
      .finally(() => setInstalling(null))
  }
  const uninstall = (name) => {
    setError(false)
    setUninstalling(name)
    postUninstall(name)
      .then(() => afterWrite(strings.uninstallDone()))
      .catch((error) => setError(error.message ?? true))
      .finally(() => setUninstalling(null))
  }
  return { reloadInstalled, runUpdates, install, uninstall }
}

function createDetailActions({
  setDetailName,
  setDetail,
  setDetailLoading,
  setDetailError,
  setDetailVersion,
  detailName,
}: DetailActionSetters) {
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
  return { openDetail, closeDetail, changeDetailVersion }
}

function PluginManagerView() {
  const [installed, setInstalled] = useState(null)
  const [updates, setUpdates] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<string | boolean>(false)
  const [installing, setInstalling] = useState(null)
  const [uninstalling, setUninstalling] = useState(null)
  const [detailName, setDetailName] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)
  const [detailVersion, setDetailVersion] = useState(null)
  const actions = createActions({
    setInstalled,
    setUpdates,
    setNotice,
    setError,
    setInstalling,
    setUninstalling,
    setDetailName,
    setDetail,
    setDetailLoading,
    setDetailError,
    setDetailVersion,
    detailName,
  })

  useEffect(() => {
    actions.reloadInstalled()
  }, [])

  // Success notices auto-dismiss after 3s (write ops must still show them).
  useEffect(() => {
    if (notice === '') return
    const timer = window.setTimeout(() => setNotice(''), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])

  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-root' },
    createElement('div', { className: 'dsh-my-plugin-manager-hint' }, strings.installHint()),
    error
      ? createElement(
          'div',
          { className: 'dsh-my-plugin-manager-error' },
          typeof error === 'string' ? `${strings.actionFailed()}：${error}` : strings.loadError(),
        )
      : null,
    notice !== ''
      ? createElement('div', { className: 'dsh-my-plugin-manager-status dsh-my-plugin-manager-saved' }, notice)
      : null,
    createElement(InstalledSection, { installed, updates, actions, uninstalling }),
    createElement(MarketSection, { actions, installing }),
    detailName !== null
      ? createElement(PluginDetailPanel, {
          name: detailName,
          detail,
          loading: detailLoading,
          error: detailError,
          version: detailVersion,
          onClose: actions.closeDetail,
          onVersionChange: actions.changeDetailVersion,
          install: actions.install,
          installing,
        })
      : null,
  )
}

/** 已安装清单 + 更新检查。 */
function InstalledSection({ installed, updates, actions, uninstalling }: InstalledSectionProps) {
  const rows =
    installed === null
      ? null
      : installed.length === 0
        ? createElement(
            'div',
            { className: 'dsh-my-plugin-manager-empty' },
            icon.file(18),
            strings.emptyInstalled(),
            createElement('span', { className: 'dsh-my-plugin-manager-empty-hint' }, strings.emptyInstalledHint()),
          )
        : installed.map((entry) =>
            createElement(InstalledRow, {
              key: entry.moduleName,
              entry,
              outdated: outdatedOf(updates, entry.moduleName),
              onOpen: () => actions.openDetail(entry.moduleName),
              onUninstall: () => actions.uninstall(entry.moduleName),
              uninstalling: uninstalling === entry.moduleName,
            }),
          )
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-section' },
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-section-head' },
      createElement('span', { className: 'dsh-my-plugin-manager-section-title' }, strings.installed()),
      createElement(
        'span',
        { className: 'dsh-my-plugin-manager-section-head-actions' },
        createElement(
          'button',
          {
            className: 'dsh-my-plugin-manager-iconbtn dsh-my-plugin-manager-iconbtn-xs',
            onClick: actions.runUpdates,
            title: strings.checkUpdates(),
            'aria-label': strings.checkUpdates(),
          },
          icon.refresh(14),
        ),
      ),
    ),
    installed === null ? createElement('div', { className: 'dsh-my-plugin-manager-status' }, strings.loading()) : rows,
    updates !== null && updates.length > 0
      ? createElement(
          'div',
          { className: 'dsh-my-plugin-manager-status dsh-my-plugin-manager-new' },
          strings.updatesAvailable(updates.length),
        )
      : updates !== null
        ? createElement('div', { className: 'dsh-my-plugin-manager-status' }, strings.noUpdates())
        : null,
  )
}

/** One installed plugin row: icon / name / state chip / version chip + uninstall. */
function InstalledRow({ entry, outdated, onOpen, onUninstall, uninstalling }: InstalledRowProps) {
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-row' },
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-row-head' },
      createElement('span', { className: 'dsh-my-plugin-manager-row-icon' }, icon.file(16)),
      createElement(
        'button',
        { className: 'dsh-my-plugin-manager-name dsh-my-plugin-manager-name-btn', onClick: onOpen },
        entry.moduleName,
      ),
      createElement(
        'span',
        {
          className: `dsh-my-plugin-manager-state ${entry.enabled ? 'dsh-my-plugin-manager-state-on' : 'dsh-my-plugin-manager-state-off'}`,
        },
        entry.enabled ? strings.running() : strings.disabled(),
      ),
      createElement(
        'span',
        { className: 'dsh-my-plugin-manager-ver' },
        entry.version === '' ? strings.noVersion() : `v${entry.version}`,
      ),
    ),
    outdated !== null
      ? createElement(
          'div',
          { className: 'dsh-my-plugin-manager-actions' },
          createElement(
            'span',
            { className: 'dsh-my-plugin-manager-update' },
            `${outdated.current} → ${outdated.latest}`,
          ),
        )
      : null,
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-actions' },
      createElement('button', { className: 'dsh-my-plugin-manager-btn', onClick: onOpen }, strings.details()),
      createElement(
        'button',
        {
          className: 'dsh-my-plugin-manager-btn dsh-my-plugin-manager-btn-danger',
          onClick: onUninstall,
          disabled: uninstalling,
        },
        icon.trash(14),
        uninstalling ? strings.uninstalling() : strings.uninstall(),
      ),
    ),
  )
}

/** 市场: npm 搜索 + 一键安装。 */
function MarketSection({ actions, installing }: MarketSectionProps) {
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
      : marketRows(results, actions.install, actions.openDetail, installing),
  )
}

/** Market rows: placeholder / empty / result list. */
function marketRows(
  results: MarketItem[] | null,
  install: (source: string) => void,
  openDetail: (name: string) => void,
  installing: string | null,
) {
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
  return results.map((item) =>
    createElement(MarketRow, {
      key: item.name,
      item,
      onOpen: () => openDetail(item.name),
      onInstall: () => install(item.name),
      installing: installing === item.name,
    }),
  )
}

/** One market search result row: npm badge / name / version chip + install. */
function MarketRow({ item, onOpen, onInstall, installing }: MarketRowProps) {
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
      createElement(
        'button',
        {
          className: 'dsh-my-plugin-manager-btn dsh-my-plugin-manager-btn-primary',
          onClick: onInstall,
          disabled: installing,
        },
        icon.plus(14),
        installing ? strings.installing() : strings.install(),
      ),
    ),
  )
}

/** The matching update entry for a module, if any. */
function outdatedOf(updates: OutdatedItem[] | null, moduleName: string): OutdatedItem | null {
  if (!Array.isArray(updates)) return null
  const hit = updates.find((entry) => entry.name === moduleName)
  return hit === undefined ? null : hit
}
