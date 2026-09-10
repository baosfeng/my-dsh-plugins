'use strict'
// ── directory tree construction ───────────────────────────────────────
/**
 * Collapse chain directories: a directory whose only child is another
 * directory merges into it (a → a.b → a.b.c …). Deep single-child paths
 * render as one dotted label with the file(s) directly beneath.
 * `root` itself is never collapsed (its name is '' and would drop the
 * top-level directory).
 */
function compressChains(node, isRoot) {
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
function sortNode(node) {
  node.children.sort((a, b) => {
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
function buildTree(counts) {
  const root = { type: 'dir', name: '', path: '', children: [], read: 0, create: 0, modify: 0 }
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
