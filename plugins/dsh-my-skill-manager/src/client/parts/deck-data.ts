// ── deck-data：详情加载 / 单作用域启停 / 批量 / 重扫 / 复制（写操作）────
// 所有请求失败都落到「内联错误 + 重试」或 toast，不静默失败；成功后用
// 服务端返回的真实数据更新本地状态。

/** 详情缓存：只替换目标 key，保留其余已加载内容。 */
function withDetail(
  previous: Record<string, DetailEntry>,
  key: string,
  entry: DetailEntry,
): Record<string, DetailEntry> {
  const next: Record<string, DetailEntry> = {}
  for (const existing of Object.keys(previous)) next[existing] = previous[existing]
  next[key] = entry
  return next
}

/** 拉 SKILL.md（异常行不请求）：loading → ready/error。 */
function loadDetailAction(store: DeckStore, cwd: string, item: SkillItem): void {
  if (isAnomaly(item)) return
  store.setState((previous) => ({
    ...previous,
    details: withDetail(previous.details, item.key, { status: 'loading', content: '', truncated: false, message: '' }),
  }))
  fetchDetail(item.name, cwd).then(
    (value) => {
      store.setState((previous) => ({
        ...previous,
        details: withDetail(previous.details, item.key, {
          status: 'ready',
          content: value.content,
          truncated: value.truncated,
          message: '',
        }),
      }))
    },
    (failure: unknown) => {
      store.setState((previous) => ({
        ...previous,
        details: withDetail(previous.details, item.key, {
          status: 'error',
          content: '',
          truncated: false,
          message: errorText(failure),
        }),
      }))
    },
  )
}

/** 展开 / 收起一张卡（首次展开时加载详情）。 */
function toggleDetailAction(store: DeckStore, cwd: string, item: SkillItem): void {
  const open = store.state.expanded.indexOf(item.key) === -1
  updateDeck(store, {
    expanded: open
      ? store.state.expanded.concat([item.key])
      : store.state.expanded.filter((entry) => entry !== item.key),
  })
  if (open) loadDetailAction(store, cwd, item)
}

/** 写入某个作用域的禁用名单；成功更新本地数据与 toast，失败落内联错误。 */
function applyScopeAction(
  store: DeckStore,
  cwd: string,
  item: SkillItem,
  scope: 'global' | 'project',
  disabled: string[],
): void {
  saveConfig(scope, disabled, scope === 'project' ? cwd : '').then(
    () => {
      store.setState((previous) => {
        if (previous.data === null) return previous
        const data =
          scope === 'global'
            ? { ...previous.data, globalDisabled: disabled }
            : { ...previous.data, projectDisabled: disabled }
        return { ...previous, data, inlineError: null }
      })
      const enabled = disabled.indexOf(item.name) === -1
      const scopeLabel = scope === 'global' ? strings.scopeGlobal() : strings.scopeProject()
      pushToast(
        store,
        enabled ? strings.toggleOnToast(item.name, scopeLabel) : strings.toggleOffToast(item.name, scopeLabel),
        enabled ? 'success' : 'default',
      )
    },
    (failure: unknown) => {
      updateDeck(store, {
        inlineError: { key: item.key, scope, message: errorText(failure), disabled },
      })
      pushToast(store, strings.updateFailedToast(), 'error')
    },
  )
}

/** 单行启停：由两个禁用名单推导当前值，再写回目标名单。 */
function toggleScopeAction(store: DeckStore, derived: DeckDerived, item: SkillItem, scope: 'global' | 'project'): void {
  if (isAnomaly(item)) return
  if (scope === 'project' && !derived.projectCtx) {
    pushToast(store, strings.projectUnavailableToast(), 'error')
    return
  }
  if (derived.data === null) return
  const current = scope === 'global' ? derived.data.globalDisabled : derived.data.projectDisabled
  const enabled = scope === 'global' ? item.globalOn : item.projectOn
  applyScopeAction(store, derived.cwd, item, scope, toggleNameInList(current, item.name, enabled))
}

/** 内联错误的重试：用失败时记下的目标名单再写一次。 */
function retryInlineAction(store: DeckStore, cwd: string, item: SkillItem): void {
  const failure = store.state.inlineError
  if (failure === null || failure.key !== item.key) return
  applyScopeAction(store, cwd, item, failure.scope, failure.disabled)
}

function copyPathAction(store: DeckStore, item: SkillItem): void {
  if (item.path === '') {
    pushToast(store, strings.copyEmpty(), 'error')
    return
  }
  copyToClipboard(item.path).then((ok) => {
    pushToast(store, ok ? strings.copyPathDone() : strings.copyFailed(), ok ? 'success' : 'error')
  })
}

function copyMdAction(store: DeckStore, item: SkillItem): void {
  const entry = store.state.details[item.key]
  const content = entry !== undefined && entry.status === 'ready' ? entry.content : ''
  if (content === '') {
    pushToast(store, strings.copyEmpty(), 'error')
    return
  }
  copyToClipboard(content).then((ok) => {
    pushToast(store, ok ? strings.copyMdDone() : strings.copyFailed(), ok ? 'success' : 'error')
  })
}

/** 批量启用 / 禁用：异常行跳过；本项目有上下文时同时写两个作用域。 */
function batchApplyAction(store: DeckStore, derived: DeckDerived, enable: boolean): void {
  const data = derived.data
  if (data === null) return
  const picked = derived.selectedItems
  const eligible = picked.filter((item) => !isAnomaly(item))
  if (eligible.length === 0) {
    updateDeck(store, { batchConfirm: false })
    pushToast(store, strings.noEligibleToast(), 'error')
    return
  }
  const names = eligible.map((item) => item.name)
  const globalNext = applyDisabledForNames(data.globalDisabled, names, !enable)
  const projectNext = applyDisabledForNames(data.projectDisabled, names, !enable)
  const jobs: Array<Promise<void>> = [saveConfig('global', globalNext, '')]
  if (derived.projectCtx) jobs.push(saveConfig('project', projectNext, derived.cwd))
  Promise.all(jobs).then(
    () => {
      store.setState((previous) => {
        if (previous.data === null) return previous
        const nextData = derived.projectCtx
          ? { ...previous.data, globalDisabled: globalNext, projectDisabled: projectNext }
          : { ...previous.data, globalDisabled: globalNext }
        return {
          ...previous,
          data: nextData,
          selectionMode: false,
          selected: [],
          batchConfirm: false,
          inlineError: null,
        }
      })
      const skipped = picked.length - eligible.length
      pushToast(
        store,
        (enable ? strings.batchOnToast(names.length) : strings.batchOffToast(names.length)) +
          (skipped > 0 ? strings.batchSkipToast(skipped) : ''),
        enable ? 'success' : 'default',
      )
    },
    (failure: unknown) => {
      updateDeck(store, { batchConfirm: false })
      const detail = errorText(failure)
      pushToast(store, strings.batchFailedToast() + (detail === '' ? '' : ' · ' + detail), 'error')
    },
  )
}

/** 重新扫描：loading 态保持列表数据；失败时已有数据就只提示，不白屏。 */
function rescanAction(store: DeckStore, cwd: string, hasData: boolean): void {
  updateDeck(store, {
    loading: true,
    error: '',
    sortOpen: false,
    batchConfirm: false,
    diagOpen: false,
    filterOpen: false,
    selectionMode: false,
    selected: [],
    inlineError: null,
  })
  rescanCatalog(cwd).then(
    (value) => {
      const nextCounts = countsOf(buildItems(value))
      updateDeck(store, { data: value, loading: false })
      pushToast(store, strings.scanDoneToast(nextCounts.all, nextCounts.anomaly), 'success')
    },
    (failure: unknown) => {
      updateDeck(store, hasData ? { loading: false } : { loading: false, error: errorText(failure) })
      pushToast(store, strings.scanFailedToast(), 'error')
    },
  )
}
