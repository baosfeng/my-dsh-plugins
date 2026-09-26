// ── i18n ──────────────────────────────────────────────────────────────
// 只保留本插件实际渲染的文案（市场搜索 / 更新检查 / 详情增强）。安装、卸载、
// 启停、清单管理相关文案随对应 UI 一并删除。
function isZh(): boolean {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}

const strings = {
  title: () => (isZh() ? '插件市场' : 'Plugin Market'),
  scopeHint: () =>
    isZh()
      ? '本页只做市场搜索、更新检查与插件详情。安装 / 卸载 / 启停 / 插件清单请用官方侧边栏插件页（设置 → 插件为只读列表）。'
      : 'This tab only offers market search, update check and package details. Install / uninstall / enable / disable and the plugin list live in the official sidebar Plugins page (Settings → Plugins stays read-only).',
  market: () => (isZh() ? '市场' : 'Market'),
  searchPlaceholder: () =>
    isZh() ? '搜索 npm 插件（如 dsh-file-activity）…' : 'Search npm plugins (e.g. dsh-file-activity)…',
  search: () => (isZh() ? '搜索' : 'Search'),
  updates: () => (isZh() ? '更新检查' : 'Update check'),
  checkUpdates: () => (isZh() ? '检查更新' : 'Check updates'),
  checkUpdatesHint: () =>
    isZh()
      ? '点右上角刷新图标，检查已安装插件是否有新版本。'
      : 'Click the refresh icon to check installed plugins for updates.',
  noUpdates: () => (isZh() ? '全部为最新版本' : 'All up to date'),
  updatesAvailable: (n: number) => (isZh() ? `${n} 个插件可更新` : `${n} update(s) available`),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  emptySearch: () => (isZh() ? '搜索 npm 插件市场' : 'Search the npm plugin market'),
  emptySearchHint: () => (isZh() ? '输入关键词，如 dsh-file-activity' : 'Type a keyword, e.g. dsh-file-activity'),
  noResults: () => (isZh() ? '没有匹配的插件' : 'No matching plugins'),
  noResultsHint: () => (isZh() ? '换个关键词试试' : 'Try a different keyword'),
  searchFailed: () => (isZh() ? '搜索失败，请重试' : 'Search failed, try again'),
  actionFailed: () => (isZh() ? '操作失败' : 'Action failed'),
  details: () => (isZh() ? '详情' : 'Details'),
  close: () => (isZh() ? '关闭' : 'Close'),
  detailFailed: () => (isZh() ? '详情加载失败' : 'Failed to load details'),
  readme: () => (isZh() ? 'README' : 'README'),
  noReadme: () => (isZh() ? '该包没有 README' : 'This package has no README'),
  versionHistory: () => (isZh() ? '版本历史' : 'Version history'),
  noVersions: () => (isZh() ? '暂无版本信息' : 'No version history'),
  dependencies: () => (isZh() ? '依赖' : 'Dependencies'),
  peerDependencies: () => (isZh() ? '对等依赖' : 'Peer dependencies'),
  noDependencies: () => (isZh() ? '无依赖' : 'No dependencies'),
  missingPeer: () => (isZh() ? '缺失' : 'missing'),
  peerHint: () =>
    isZh()
      ? '对等依赖（peer）需由运行环境提供；缺失项已高亮。'
      : 'Peer dependencies must be provided by the runtime; missing ones are highlighted.',
  metadata: () => (isZh() ? '元数据' : 'Metadata'),
  author: () => (isZh() ? '作者' : 'Author'),
  license: () => (isZh() ? '许可证' : 'License'),
  repository: () => (isZh() ? '仓库' : 'Repository'),
  downloads: () => (isZh() ? '月下载量' : 'Downloads / month'),
  loadingDetail: () => (isZh() ? '加载插件详情…' : 'Loading plugin details…'),
  version: () => (isZh() ? '版本' : 'version'),
  noVersion: () => (isZh() ? '—' : '—'),
}
