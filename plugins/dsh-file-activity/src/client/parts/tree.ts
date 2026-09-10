// ── directory tree construction ───────────────────────────────────────

/** 目录树节点：dir 用 path/children/compressed，file 用 abs/firstSeen/lastSeen。 */
interface TreeNode {
  type: 'dir' | 'file'
  name: string
  read: number
  create: number
  modify: number
  /** dir 专有：根到本目录的相对路径（根为 ''）。 */
  path?: string
  /** file 专有：文件绝对路径。 */
  abs?: string
  /** dir 专有：子节点（目录在前、文件在后）。 */
  children?: TreeNode[]
  /** dir 专有：单子链压缩后置 true（name 已是点分路径）。 */
  compressed?: boolean
  /** file 专有：首次出现时间（host 记录）。 */
  firstSeen?: number
  /** file 专有：最近一次活动时间（host 记录）。 */
  lastSeen?: number
}

/**
 * Collapse chain directories: a directory whose only child is another
 * directory merges into it (a → a.b → a.b.c …). Deep single-child paths
 * render as one dotted label with the file(s) directly beneath.
 * `root` itself is never collapsed (its name is '' and would drop the
 * top-level directory).
 */
function compressChains(node: TreeNode, isRoot: boolean): void {
  for (const child of node.children) {
    if (child.type === 'dir') compressChains(child, false)
  }
  if (isRoot) return
  while (node.children.length === 1 && node.children[0].type === 'dir') {
    const only = node.children[0]
    node.name = `${node.name}.${only.name}`
    node.children = only.children
    node.compressed = true
  }
}

/**
 * Sort a directory node: directories first (alphabetically), then files
 * (by total activity, then name); recurse into directories.
 */
function sortNode(node: TreeNode): void {
  node.children.sort((a: TreeNode, b: TreeNode) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    if (a.type === 'dir') return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    const ta = a.read + a.create + a.modify
    const tb = b.read + b.create + b.modify
    return tb - ta || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  })
  for (const child of node.children) {
    if (child.type === 'dir') sortNode(child)
  }
}

/**
 * Build a nested directory tree from per-file counts, keyed by the file's
 * absolute path. Every directory node aggregates its subtree counters and
 * sorts directories first (alphabetically), then files (by activity).
 */
function buildTree(counts: Record<string, FileCounter>): TreeNode {
  const root: TreeNode = { type: 'dir', name: '', path: '', children: [], read: 0, create: 0, modify: 0 }
  for (const [abs, counter] of Object.entries(counts)) {
    const parts = abs.split('/').filter((part) => part !== '')
    if (parts.length === 0) continue
    const name = parts[parts.length - 1]
    let node = root
    for (const dir of parts.slice(0, -1)) {
      let child = node.children.find((c) => c.type === 'dir' && c.name === dir)
      if (child === undefined) {
        child = {
          type: 'dir',
          name: dir,
          path: `${node.path}/${dir}`,
          children: [],
          read: 0,
          create: 0,
          modify: 0,
        }
        node.children.push(child)
      }
      node = child
      node.read += counter.read
      node.create += counter.create
      node.modify += counter.modify
    }
    node.children.push({
      type: 'file',
      name,
      abs,
      read: counter.read,
      create: counter.create,
      modify: counter.modify,
      firstSeen: counter.firstSeen,
      lastSeen: counter.lastSeen,
    })
  }
  sortNode(root)
  compressChains(root, true)
  return root
}
