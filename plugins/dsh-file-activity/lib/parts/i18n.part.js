'use strict'
// ── i18n ──────────────────────────────────────────────────────────────
function isZh() {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}
const strings = {
  title: () => (isZh() ? '文件活动' : 'File Activity'),
  recent: () => (isZh() ? '最近访问' : 'Recent'),
  stats: () => (isZh() ? '文件统计' : 'File Stats'),
  empty: () => (isZh() ? '暂无文件活动记录' : 'No file activity yet'),
  emptyHint: () =>
    isZh()
      ? '在侧边栏打开文件、编辑保存，或让 agent 读写文件（创建/读取/修改），都会记录在这里。点击任意文件将在侧边栏内用原生预览打开（代码高亮 / Markdown 渲染 / 图片 / PDF…）。'
      : 'Opening files in the sidebar, editing, or agent file operations (create/read/modify) are recorded here. Click any file to open it in the sidebar with native preview (syntax highlighting / Markdown rendering / images / PDF…).',
  refresh: () => (isZh() ? '刷新' : 'Refresh'),
  clear: () => (isZh() ? '清空' : 'Clear'),
  clearConfirm: () => (isZh() ? '确定清空当前会话的全部文件活动记录？' : 'Clear all file activity for this session?'),
  read: () => (isZh() ? '读取' : 'read'),
  create: () => (isZh() ? '新增' : 'create'),
  modify: () => (isZh() ? '修改' : 'modify'),
  delete: () => (isZh() ? '删除' : 'delete'),
  readShort: () => (isZh() ? '读' : 'R'),
  createShort: () => (isZh() ? '增' : 'C'),
  modifyShort: () => (isZh() ? '改' : 'M'),
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  created: () => (isZh() ? '创建' : 'Created'),
  lastSeen: () => (isZh() ? '最近访问' : 'Last seen'),
  justNow: () => (isZh() ? '刚刚' : 'just now'),
  minutesAgo: (m) => (isZh() ? `${m} 分钟前` : `${m}m ago`),
  hoursAgo: (h) => (isZh() ? `${h} 小时前` : `${h}h ago`),
  daysAgo: (d) => (isZh() ? `${d} 天前` : `${d}d ago`),
  closePreview: () => (isZh() ? '关闭预览' : 'Close preview'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  previewUnsupported: () => (isZh() ? '该文件类型暂不支持预览' : 'This file type cannot be previewed yet'),
  previewFailed: () => (isZh() ? '预览加载失败' : 'Preview failed to load'),
  fileMissing: () => (isZh() ? '文件不存在或已被删除' : 'This file no longer exists'),
  fileOutside: () =>
    isZh() ? '文件位于工作区外，暂无法读取内容' : 'The file is outside the workspace and cannot be read',
  downloadToView: () => (isZh() ? '下载查看' : 'download to view'),
  clickOutsideToClose: () => (isZh() ? '点击外部关闭' : 'Click outside to close'),
  autoCloseHint: () => (isZh() ? '预览失败，即将自动关闭' : 'Preview failed — closing automatically'),
}
