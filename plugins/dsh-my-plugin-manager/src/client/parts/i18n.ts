// ── i18n ──────────────────────────────────────────────────────────────
function isZh(): boolean {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}

const strings = {
  title: () => (isZh() ? '插件管理' : 'Plugin Manager'),
  installed: () => (isZh() ? '已安装' : 'Installed'),
  market: () => (isZh() ? '市场' : 'Market'),
  searchPlaceholder: () =>
    isZh() ? '搜索 npm 插件（如 dsh-file-activity）…' : 'Search npm plugins (e.g. dsh-file-activity)…',
  search: () => (isZh() ? '搜索' : 'Search'),
  install: () => (isZh() ? '安装' : 'Install'),
  uninstall: () => (isZh() ? '卸载' : 'Uninstall'),
  checkUpdates: () => (isZh() ? '检查更新' : 'Check updates'),
  noUpdates: () => (isZh() ? '全部为最新版本' : 'All up to date'),
  updatesAvailable: (n: number) => (isZh() ? `${n} 个插件可更新` : `${n} update(s) available`),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  emptyInstalled: () => (isZh() ? '暂无已安装插件' : 'No plugins installed'),
  emptyInstalledHint: () =>
    isZh() ? '从市场搜索安装插件后，会显示在这里。' : 'Plugins installed from the market will appear here.',
  emptySearch: () => (isZh() ? '搜索 npm 插件市场' : 'Search the npm plugin market'),
  emptySearchHint: () => (isZh() ? '输入关键词，如 dsh-file-activity' : 'Type a keyword, e.g. dsh-file-activity'),
  noResults: () => (isZh() ? '没有匹配的插件' : 'No matching plugins'),
  noResultsHint: () => (isZh() ? '换个关键词试试' : 'Try a different keyword'),
  searchFailed: () => (isZh() ? '搜索失败，请重试' : 'Search failed, try again'),
  running: () => (isZh() ? '运行中' : 'running'),
  disabled: () => (isZh() ? '已禁用' : 'disabled'),
  installing: () => (isZh() ? '安装中…' : 'Installing…'),
  uninstalling: () => (isZh() ? '卸载中…' : 'Uninstalling…'),
  version: () => (isZh() ? '版本' : 'version'),
  installHint: () =>
    isZh()
      ? '安装/卸载通过 `dsh plugin` 写入 profile（npm 包或 link 路径）；新插件在下次重启 DSH 后加载。'
      : 'Install/uninstall writes through `dsh plugin` (npm package or link: path); new plugins load on the next DSH restart.',
  installDone: () => (isZh() ? '安装完成（重启后加载）' : 'Installed (loads on restart)'),
  uninstallDone: () => (isZh() ? '已卸载（重启后移除）' : 'Uninstalled (removed on restart)'),
  actionFailed: () => (isZh() ? '操作失败' : 'Action failed'),
  noVersion: () => (isZh() ? '—' : '—'),
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
  installLatest: () => (isZh() ? '安装' : 'Install'),
  installAt: (version: string) => (isZh() ? `安装 v${version}` : `Install v${version}`),
  loadingDetail: () => (isZh() ? '加载插件详情…' : 'Loading plugin details…'),
}
