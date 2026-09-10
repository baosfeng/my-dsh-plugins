'use strict'
// ── row rendering helpers (recent list & stats tree) ──────────────────
const opClass = (op) =>
  op === 'create'
    ? 'dfa-op-create'
    : op === 'modify'
      ? 'dfa-op-modify'
      : op === 'delete'
        ? 'dfa-op-delete'
        : 'dfa-op-read'
const opLabel = (op) =>
  op === 'create'
    ? strings.create()
    : op === 'modify'
      ? strings.modify()
      : op === 'delete'
        ? strings.delete()
        : strings.read()
/** Tooltip for a stats file row: absolute path + created / last-seen times. */
const fileTitle = (abs, firstSeen, lastSeen) => {
  const times = []
  if (typeof firstSeen === 'number') times.push(`${strings.created()} ${formatTime(firstSeen)}`)
  if (typeof lastSeen === 'number') times.push(`${strings.lastSeen()} ${formatTime(lastSeen)}`)
  return times.length > 0 ? `${abs}\n${times.join(' · ')}` : abs
}
/** Count pills for a file/dir node — only actions that actually happened are
 *  shown (a zero count renders no pill; all-zero nodes render no pill group,
 *  keeping untouched files visually quiet). */
const countPills = (node) => {
  const pills = []
  if (node.read > 0)
    pills.push(createElement('span', { className: 'dfa-count dfa-count-read' }, `${strings.readShort()} ${node.read}`))
  if (node.create > 0)
    pills.push(
      createElement('span', { className: 'dfa-count dfa-count-create' }, `${strings.createShort()} ${node.create}`),
    )
  if (node.modify > 0)
    pills.push(
      createElement('span', { className: 'dfa-count dfa-count-modify' }, `${strings.modifyShort()} ${node.modify}`),
    )
  if (pills.length === 0) return null
  return createElement('span', { className: 'dfa-counts', style: { paddingLeft: '6px' } }, ...pills)
}
/** Extension of a file name (lowercase, no leading dot); '' when none.
 *  Dotfiles map to their whole name ('.gitignore' → 'gitignore') so the
 *  badge table can cover them; 'notes.' still yields ''. */
const extOf = (name) => {
  const dot = name.lastIndexOf('.')
  if (dot > 0) return name.slice(dot + 1).toLowerCase()
  if (dot === 0) return name.slice(1).toLowerCase()
  return ''
}
/** Extension-less but common build files → their badge key. */
const NAME_BADGES = {
  makefile: 'makefile',
  dockerfile: 'dockerfile',
  'cmakelists.txt': 'cmake',
}
/** Badge key for a file name: basename match first, then extension. */
const badgeKeyOf = (name) => {
  const base = name.toLowerCase()
  const named = NAME_BADGES[base]
  if (named !== undefined) return named
  return extOf(name)
}
/** A stats-tree file row: icon + name + count pills + relative time. */
const fileRow = (file, depth, onOpen) =>
  createElement(
    'div',
    {
      key: file.abs,
      className: 'dfa-row',
      onClick: () => onOpen(file.abs),
      style: { paddingLeft: 8 + depth * 20 },
      title: fileTitle(file.abs, file.firstSeen, file.lastSeen),
    },
    createElement('span', { className: 'dfa-row-icon dfa-icon-file' }, fileIconByExt(badgeKeyOf(file.name))),
    createElement('span', { className: 'dfa-row-name dfa-name-file' }, file.name),
    countPills(file),
    file.lastSeen ? createElement('span', { className: 'dfa-time' }, formatRelative(file.lastSeen)) : null,
  )
/** One stats-tree node: file rows render inline, dirs toggle collapse. */
function renderTreeNode(node, depth, collapsedDirs, onToggleDir, onOpen) {
  if (node.type === 'file') return fileRow(node, depth, onOpen)
  const collapsed = collapsedDirs.has(node.path)
  return createElement(
    'div',
    { key: node.path },
    createElement(
      'div',
      {
        className: 'dfa-row dfa-row-dir',
        onClick: () => onToggleDir(node.path),
        style: { paddingLeft: 8 + depth * 20 },
        title: `${node.path}/`,
      },
      createElement('span', { className: 'dfa-chevron' }, collapsed ? icon.chevronRight(13) : icon.chevronDown(13)),
      createElement('span', { className: 'dfa-row-icon dfa-icon-folder' }, icon.folder(14)),
      createElement('span', { className: 'dfa-row-name' }, node.compressed ? node.name : node.name + '/'),
      countPills(node),
    ),
    collapsed
      ? null
      : node.children.map((child) => renderTreeNode(child, depth + 1, collapsedDirs, onToggleDir, onOpen)),
  )
}
/** A recent-list row: op badge + basename + relative time. */
const recentEntry = (entry, onOpen) =>
  createElement(
    'div',
    {
      key: `${entry.path}:${entry.time}:${entry.op}`,
      className: 'dfa-row',
      onClick: () => onOpen(entry.path),
      title: entry.path,
    },
    createElement('span', { className: `dfa-op ${opClass(entry.op)}` }, opLabel(entry.op)),
    createElement('span', { className: 'dfa-row-name' }, basenameOf(entry.path)),
    createElement('span', { className: 'dfa-time' }, formatRelative(entry.time)),
  )
/** Toggle a key in a Set (directory collapse state). */
function toggleInSet(set, key) {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
/** Clear the current session's records host-side and reset its bucket. */
function clearSessionData(dataStore, sessionId) {
  if (!window.confirm(strings.clearConfirm())) return
  postClear(sessionId)
  const current = dataStore.getSnapshot()
  dataStore.set({
    bySession: {
      ...(current.bySession ?? {}),
      [sessionId]: { recent: [], counts: {}, loading: false },
    },
  })
}
/** Manual refresh: fetch stats + the authoritative cwd for this session. */
function refreshSessionData(dataStore, sessionId, setCwd, setError) {
  if (sessionId === '') return
  void fetchStats(sessionId)
    .then((value) => {
      if (value === null) return
      setCwd((prev) => prev || value.cwd || '')
      const current = dataStore.getSnapshot()
      dataStore.set({
        bySession: {
          ...(current.bySession ?? {}),
          [sessionId]: { recent: value.recent ?? [], counts: value.counts ?? {}, loading: false },
        },
      })
      setError(false)
    })
    .catch(() => setError(true))
  void fetchSessionCwd(sessionId).then((cwd) => {
    if (cwd !== '') setCwd(cwd)
  })
}
