// ── deck-state：技能台的全部可变状态 + 生命周期副作用（唯一状态源）──────
// 根组件只有 3 个 hook 槽（state / searchRef / toastSeq）+ 4 个 effect：
// 挂载加载、toast 计时、弹出层外点关闭（排序菜单 / 筛选面板）、全局键盘
// （⌘K / Esc 分级）。
// 所有事件处理都通过 updateDeck 产生新 state，子组件保持纯函数。

interface DeckState {
  data: ListValue | null
  loading: boolean
  error: string
  sessionCwd: string
  query: string
  source: string
  status: string
  unusedOnly: boolean
  viewMode: string
  sortKey: SortKey
  sortDir: string
  sortOpen: boolean
  filterOpen: boolean
  expanded: string[]
  selectionMode: boolean
  selected: string[]
  batchConfirm: boolean
  diagOpen: boolean
  details: Record<string, DetailEntry>
  inlineError: InlineErrorValue | null
  toast: ToastValue | null
}

interface DeckStore {
  state: DeckState
  setState(value: DeckState | ((previous: DeckState) => DeckState)): void
  searchRef: { current: unknown }
  toastSeq: { value: number }
}

const INITIAL_DECK_STATE: DeckState = {
  data: null,
  loading: true,
  error: '',
  sessionCwd: '',
  query: '',
  source: 'all',
  status: 'all',
  unusedOnly: false,
  viewMode: 'cards',
  sortKey: 'name',
  sortDir: 'asc',
  sortOpen: false,
  filterOpen: false,
  expanded: [],
  selectionMode: false,
  selected: [],
  batchConfirm: false,
  diagOpen: false,
  details: {},
  inlineError: null,
  toast: null,
}

/** 合并式更新（保持其余状态不变）。 */
function updateDeck(store: DeckStore, patch: Partial<DeckState>): void {
  store.setState((previous) => ({ ...previous, ...patch }))
}

/** 发一条 toast（编号自增，用于重启自动隐藏计时）。 */
function pushToast(store: DeckStore, message: string, kind: ToastValue['kind']): void {
  store.toastSeq.value += 1
  updateDeck(store, { toast: { id: store.toastSeq.value, message, kind } })
}

/** 把焦点移回搜索框（⌘K / 清空搜索后）。 */
function focusDeckSearch(store: DeckStore): void {
  setTimeout(() => {
    const node = store.searchRef.current as { focus?: () => void } | null
    if (node !== null && node !== undefined && typeof node.focus === 'function') node.focus()
  }, 0)
}

/** 挂载：读会话 cwd → 拉 /list；组件卸载后丢弃迟到的响应。 */
function mountDeck(store: DeckStore): () => void {
  let cancelled = false
  const sessionId = currentSessionId()
  fetchSessionCwd(sessionId).then((detected) => {
    if (cancelled) return
    updateDeck(store, { sessionCwd: detected })
    fetchList(detected).then(
      (list) => {
        if (!cancelled) updateDeck(store, { data: list, loading: false })
      },
      (failure: unknown) => {
        if (!cancelled) updateDeck(store, { error: errorText(failure), loading: false })
      },
    )
  })
  return () => {
    cancelled = true
  }
}

/** toast 2.4s 后自动隐藏。 */
function hideToastLater(store: DeckStore): () => void {
  const timer = setTimeout(() => updateDeck(store, { toast: null }), 2400)
  return () => clearTimeout(timer)
}

/** 弹出层（排序菜单 / 筛选面板）：点空白处关闭（触发按钮与面板自己 stopPropagation）。 */
function closePopoversOnOutsideClick(store: DeckStore): () => void {
  const close = (): void => updateDeck(store, { sortOpen: false, filterOpen: false })
  document.addEventListener('click', close)
  return () => document.removeEventListener('click', close)
}

/** ⌘K / Ctrl+K：退出诊断台与选择模式并聚焦搜索框；命中返回 true。 */
function handleDeckShortcut(
  store: DeckStore,
  event: { key?: string; metaKey?: boolean; ctrlKey?: boolean; preventDefault?: () => void },
): boolean {
  const withModifier = event.metaKey === true || event.ctrlKey === true
  const isK = event.key === 'k' || event.key === 'K'
  if (!withModifier || !isK) return false
  if (typeof event.preventDefault === 'function') event.preventDefault()
  updateDeck(store, {
    diagOpen: false,
    selectionMode: false,
    selected: [],
    batchConfirm: false,
    sortOpen: false,
    filterOpen: false,
  })
  focusDeckSearch(store)
  return true
}

/** Esc 分级：筛选面板 → 排序菜单 → 批量确认 → 诊断台 → 选择模式 → 搜索词 → 展开详情。 */
function handleDeckEscape(store: DeckStore): void {
  const state = store.state
  if (state.filterOpen) {
    updateDeck(store, { filterOpen: false })
    return
  }
  if (state.sortOpen) {
    updateDeck(store, { sortOpen: false })
    return
  }
  if (state.batchConfirm) {
    updateDeck(store, { batchConfirm: false })
    return
  }
  if (state.diagOpen) {
    updateDeck(store, { diagOpen: false })
    return
  }
  if (state.selectionMode) {
    updateDeck(store, { selectionMode: false, selected: [] })
    return
  }
  if (state.query !== '') {
    updateDeck(store, { query: '' })
    return
  }
  if (state.expanded.length > 0) updateDeck(store, { expanded: [] })
}

function bindDeckKeys(store: DeckStore): () => void {
  const onKeyDown = (event: {
    key?: string
    metaKey?: boolean
    ctrlKey?: boolean
    preventDefault?: () => void
  }): void => {
    if (handleDeckShortcut(store, event)) return
    if (event.key === 'Escape') handleDeckEscape(store)
  }
  document.addEventListener('keydown', onKeyDown as EventListener)
  return () => document.removeEventListener('keydown', onKeyDown as EventListener)
}

/** 根组件的状态 hook（顺序固定：state / searchRef / toastSeq + 4 个 effect）。 */
function useDeck(): DeckStore {
  const [state, setState] = useState<DeckState>(INITIAL_DECK_STATE)
  const [searchRef] = useState<{ current: unknown }>(() => ({ current: null }))
  const [toastSeq] = useState<{ value: number }>(() => ({ value: 0 }))
  const store: DeckStore = { state, setState, searchRef, toastSeq }
  useEffect(() => mountDeck(store), [])
  useEffect(() => (state.toast === null ? undefined : hideToastLater(store)), [state.toast])
  useEffect(
    () => (state.sortOpen || state.filterOpen ? closePopoversOnOutsideClick(store) : undefined),
    [state.sortOpen, state.filterOpen],
  )
  useEffect(() => bindDeckKeys(store), [state])
  return store
}
