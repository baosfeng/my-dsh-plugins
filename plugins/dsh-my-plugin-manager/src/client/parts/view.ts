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
  setUpdating: (value: string | null) => void
  setEnabling: (value: string | null) => void
  setDisabling: (value: string | null) => void
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
  update: (name: string) => void
  enable: (name: string) => void
  disable: (name: string) => void
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
  updating: string | null
  enabling: string | null
  disabling: string | null
}

/** InstalledRow props（uninstalling 为「本行正在卸载」）。 */
interface InstalledRowProps {
  entry: InstalledEntry
  outdated: OutdatedItem | null
  onOpen: () => void
  onUninstall: () => void
  onUpdate: () => void
  onEnable: () => void
  onDisable: () => void
  uninstalling: boolean
  updating: boolean
  enabling: boolean
  disabling: boolean
}

/** MarketSection props。 */
interface MarketSectionProps {
  actions: PluginActions
  installing: string | null
  installed: InstalledEntry[] | null
}

/** MarketRow props（installing 为「本行正在安装」）。 */
interface MarketRowProps {
  item: MarketItem
  onOpen: () => void
  onInstall: () => void
  installing: boolean
  isInstalled: boolean
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
  setUpdating,
  setEnabling,
  setDisabling,
}: ListActionSetters) {
  const reloadInstalled = () => {
    fetchInstalled()
      .then((value) => setInstalled(value.entries ?? []))
      .catch(() => setError(true))
  }
  const runUpdates = () => {
    setError(false)
    // 我们的实现中，更新信息是在 /installed 接口中返回的
    // 所以点击"检查更新"按钮应该重新加载已安装列表
    reloadInstalled()
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
  const update = (name) => {
    setError(false)
    setUpdating(name)
    postUpdate(name)
      .then(() => afterWrite(strings.updateDone()))
      .catch((error) => setError(error.message ?? true))
      .finally(() => setUpdating(null))
  }
  const enable = (name) => {
    setError(false)
    setEnabling(name)
    postEnable(name)
      .then(() => afterWrite(strings.enableDone()))
      .catch((error) => setError(error.message ?? true))
      .finally(() => setEnabling(null))
  }
  const disable = (name) => {
    setError(false)
    setDisabling(name)
    postDisable(name)
      .then(() => afterWrite(strings.disableDone()))
      .catch((error) => setError(error.message ?? true))
      .finally(() => setDisabling(null))
  }
  return { reloadInstalled, runUpdates, install, uninstall, update, enable, disable }
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

function usePluginManagerState() {
  const [installed, setInstalled] = useState(null)
  const [updates, setUpdates] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<string | boolean>(false)
  const [installing, setInstalling] = useState(null)
  const [uninstalling, setUninstalling] = useState(null)
  const [updating, setUpdating] = useState(null)
  const [enabling, setEnabling] = useState(null)
  const [disabling, setDisabling] = useState(null)
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
    setUpdating,
    setEnabling,
    setDisabling,
    setDetailName,
    setDetail,
    setDetailLoading,
    setDetailError,
    setDetailVersion,
    detailName,
  })

  return {
    installed,
    updates,
    notice,
    error,
    installing,
    uninstalling,
    updating,
    enabling,
    disabling,
    detailName,
    detail,
    detailLoading,
    detailError,
    detailVersion,
    actions,
  }
}

function useNoticeAutoDismiss(notice: string, setNotice: (value: string) => void) {
  useEffect(() => {
    if (notice === '') return
    const timer = window.setTimeout(() => setNotice(''), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])
}

function PluginManagerView() {
  const state = usePluginManagerState()
  const {
    installed,
    updates,
    notice,
    error,
    installing,
    uninstalling,
    updating,
    enabling,
    disabling,
    detailName,
    detail,
    detailLoading,
    detailError,
    detailVersion,
    actions,
  } = state

  useEffect(() => {
    actions.reloadInstalled()
  }, [])

  useNoticeAutoDismiss(notice, () => {}) // setNotice is inside actions

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
    createElement(InstalledSection, { installed, updates, actions, uninstalling, updating, enabling, disabling }),
    createElement(MarketSection, { actions, installing, installed }),
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
function InstalledSection({
  installed,
  updates,
  actions,
  uninstalling,
  updating,
  enabling,
  disabling,
}: InstalledSectionProps) {
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
              onUpdate: () => actions.update(entry.moduleName),
              onEnable: () => actions.enable(entry.moduleName),
              onDisable: () => actions.disable(entry.moduleName),
              uninstalling: uninstalling === entry.moduleName,
              updating: updating === entry.moduleName,
              enabling: enabling === entry.moduleName,
              disabling: disabling === entry.moduleName,
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
function InstalledRow({
  entry,
  outdated,
  onOpen,
  onUninstall,
  onUpdate,
  onEnable,
  onDisable,
  uninstalling,
  updating,
  enabling,
  disabling,
}: InstalledRowProps) {
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-row' },
    createElement(InstalledRowHeader, { entry, onOpen }),
    entry.updateAvailable !== null && entry.updateAvailable !== undefined
      ? createElement(UpdateAvailableInfo, { updateAvailable: entry.updateAvailable })
      : null,
    createElement(InstalledRowActions, {
      entry,
      onOpen,
      onUninstall,
      onUpdate,
      onEnable,
      onDisable,
      uninstalling,
      updating,
      enabling,
      disabling,
    }),
  )
}

function InstalledRowHeader({ entry, onOpen }: { entry: InstalledEntry; onOpen: () => void }) {
  return createElement(
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
  )
}

function UpdateAvailableInfo({ updateAvailable }: { updateAvailable: { current: string; latest: string } }) {
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-actions' },
    createElement(
      'span',
      { className: 'dsh-my-plugin-manager-update' },
      `${updateAvailable.current} → ${updateAvailable.latest}`,
    ),
  )
}

function InstalledRowActions({
  entry,
  onOpen,
  onUninstall,
  onUpdate,
  onEnable,
  onDisable,
  uninstalling,
  updating,
  enabling,
  disabling,
}: {
  entry: InstalledEntry
  onOpen: () => void
  onUninstall: () => void
  onUpdate: () => void
  onEnable: () => void
  onDisable: () => void
  uninstalling: boolean
  updating: boolean
  enabling: boolean
  disabling: boolean
}) {
  return createElement(
    'div',
    { className: 'dsh-my-plugin-manager-actions' },
    createElement('button', { className: 'dsh-my-plugin-manager-btn', onClick: onOpen }, strings.details()),
    entry.updateAvailable !== null && entry.updateAvailable !== undefined
      ? createElement(
          'button',
          {
            className: 'dsh-my-plugin-manager-btn dsh-my-plugin-manager-btn-primary',
            onClick: onUpdate,
            disabled: updating,
          },
          icon.arrowUp(14),
          updating ? strings.updating() : strings.update(),
        )
      : null,
    entry.enabled
      ? createElement(
          'button',
          {
            className: 'dsh-my-plugin-manager-btn',
            onClick: onDisable,
            disabled: disabling,
          },
          icon.powerOff(14),
          disabling ? strings.disabling() : strings.disable(),
        )
      : createElement(
          'button',
          {
            className: 'dsh-my-plugin-manager-btn dsh-my-plugin-manager-btn-primary',
            onClick: onEnable,
            disabled: enabling,
          },
          icon.powerOn(14),
          enabling ? strings.enabling() : strings.enable(),
        ),
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
  )
}

/** 市场: npm 搜索 + 一键安装。 */
function MarketSection({ actions, installing, installed }: MarketSectionProps) {
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
      : marketRows(results, actions.install, actions.openDetail, installing, installed),
  )
}

/** Market rows: placeholder / empty / result list. */
function marketRows(
  results: MarketItem[] | null,
  install: (source: string) => void,
  openDetail: (name: string) => void,
  installing: string | null,
  installed: InstalledEntry[] | null,
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
      isInstalled: installed !== null && installed.some((entry) => entry.moduleName === item.name),
    }),
  )
}

/** One market search result row: npm badge / name / version chip + install. */
function MarketRow({ item, onOpen, onInstall, installing, isInstalled }: MarketRowProps) {
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
      isInstalled
        ? createElement(
            'span',
            { className: 'dsh-my-plugin-manager-state dsh-my-plugin-manager-state-on' },
            strings.installed(),
          )
        : null,
    ),
    createElement('div', { className: 'dsh-my-plugin-manager-desc' }, item.description),
    createElement(
      'div',
      { className: 'dsh-my-plugin-manager-actions' },
      createElement('button', { className: 'dsh-my-plugin-manager-btn', onClick: onOpen }, strings.details()),
      isInstalled
        ? createElement(
            'button',
            {
              className: 'dsh-my-plugin-manager-btn',
              disabled: true,
            },
            icon.check(14),
            strings.installed(),
          )
        : createElement(
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
