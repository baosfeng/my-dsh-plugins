/**
 * scripts/lib/action-pins.mjs — GitHub Action「同一仓库的多个子路径必须用同一 ref」判定（issue #435）。
 *
 * 背景（本文件就是被这个事故逼出来的）：`.github/workflows/codeql.yml` 里同一个仓库
 * `github/codeql-action` 的两个子路径被钉在**不同 commit** 上 —— `init@b96794f0`（4.38.0）
 * 与 `analyze@1c5b6756`（4.38.1）。Dependabot 把「`github/codeql-action/analyze`」当作
 * **子路径级独立依赖**（PR #430 的 `dependency-name: github/codeql-action/analyze`），
 * 于是只升 analyze、没升 init → 同一次分析里 init 写 4.38.0 的配置、analyze 用 4.38.1 去读，
 * 恒红：`Loaded a configuration file for version 4.38.0, but running version 4.38.1`。
 * 这不是平台抖动，是仓库侧配置分叉，而**没有任何机制**阻止它再次发生。
 *
 * 判据（唯一一条，故意保持极简）：**同一个 Action 仓库（owner/repo）的所有 `uses:` 必须同 ref**。
 * 依据是 GitHub Actions 的既定形态——单仓库多 action：同一 commit 下 `init/`、`analyze/`、
 * `autobuild/` 等子目录同时存在，**同一 SHA 即同一版本**（经 GitHub API 核实：
 * refs/tags/v4.38.1 → 1c5b6756，该 commit 下 init/ 与 analyze/ 都在）。
 *
 * 纯函数、零 IO：扫描 workflow 目录与退出码在 scripts/check-action-pins.mjs。
 */

/** `uses:` 行的值（含 `- uses:`）；调用前必须先用 stripYamlComment 剥掉 YAML 注释。 */
const USES_LINE_RE = /^\s*(?:-\s*)?uses:\s*(.+?)\s*$/
/** 行尾版本注释（`…@sha # v4`）——只用于展示，不参与判定。 */
const TRAILING_COMMENT_RE = /\s#\s*(\S.*?)\s*$/

/**
 * 剥掉 YAML 注释：整行注释返回空串（codeql.yml 里 `#   uses: actions/setup-example@v1` 这类
 * **示例注释**必须被忽略，否则门禁会对注释里的假 action 报错），行内注释按 ` #` 截断。
 * 不处理引号内的 `#`——workflow 里用不到，且引入引号状态机会让解析器复杂到无法被单测钉死。
 */
export function stripYamlComment(line) {
  if (line.trimStart().startsWith('#')) return ''
  const idx = line.indexOf(' #')
  return idx >= 0 ? line.slice(0, idx) : line
}

/** 去掉 `'...'` / `"..."` 包裹，并 trim。 */
function unquote(value) {
  const v = value.trim()
  if (v.length >= 2 && ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))) {
    return v.slice(1, -1)
  }
  return v
}

/**
 * `owner/repo[/sub/path]@ref` → `{ action: 'owner/repo', subpath, ref }`。
 * 非远程 action（`./local`、`docker://…`）、缺 owner/repo、缺 ref、含 `.`/`..` 段的一律返回 null
 * （不参与判定——它们不是「同一 Action 的多子路径」问题）。
 */
export function parseActionRef(spec) {
  const raw = unquote(String(spec ?? ''))
  const at = raw.lastIndexOf('@')
  if (at <= 0 || at === raw.length - 1) return null
  const path = raw.slice(0, at).trim()
  const ref = raw.slice(at + 1).trim()
  if (path === '' || ref === '') return null
  if (path.startsWith('./') || path.startsWith('../') || path.startsWith('/') || path.includes('://')) return null
  const parts = path.split('/').filter((p) => p !== '')
  if (parts.length < 2 || parts.some((p) => p === '.' || p === '..')) return null
  return { action: `${parts[0]}/${parts[1]}`, subpath: parts.slice(2).join('/'), ref }
}

/** 从 workflow 文本里取出所有 `uses:` 条目（注释行、非远程 action 已被剔除）。 */
export function extractActionUses(text, file = '(inline)') {
  const out = []
  String(text)
    .split('\n')
    .forEach((line, i) => {
      const code = stripYamlComment(line)
      if (code.trim() === '') return
      const m = code.match(USES_LINE_RE)
      if (!m) return
      const parsed = parseActionRef(m[1])
      if (!parsed) return
      const version = (line.match(TRAILING_COMMENT_RE) ?? [])[1] ?? ''
      out.push({ file, line: i + 1, version, spec: unquote(m[1]), ...parsed })
    })
  return out
}

/**
 * 按 Action 仓库分组，返回 ref **不唯一**的那些（= 版本分叉）。
 * 只有一个 ref 的 Action 一律不报（含「同一 Action 被多个 workflow 引用但版本一致」这种合法形态）。
 */
export function findPinMismatches(uses) {
  const byAction = new Map()
  for (const use of uses) {
    if (!byAction.has(use.action)) byAction.set(use.action, new Map())
    const byRef = byAction.get(use.action)
    if (!byRef.has(use.ref)) byRef.set(use.ref, [])
    byRef.get(use.ref).push(use)
  }
  const mismatches = []
  for (const [action, byRef] of byAction) {
    if (byRef.size < 2) continue
    const refs = [...byRef.entries()]
      .map(([ref, list]) => ({
        ref,
        version: list[0].version,
        subpaths: [...new Set(list.map((u) => u.subpath))],
        uses: list,
      }))
      .sort((a, b) => (a.ref < b.ref ? -1 : 1))
    mismatches.push({
      action,
      refs,
      subpathCount: new Set(refs.flatMap((g) => g.subpaths)).size,
      files: [...new Set(refs.flatMap((g) => g.uses.map((u) => u.file)))].sort(),
    })
  }
  return mismatches.sort((a, b) => (a.action < b.action ? -1 : 1))
}

/** 渲染可读报表（CLI 与单测共用；含修法提示，避免只报错不给出路）。 */
export function renderMismatches(mismatches) {
  const lines = []
  for (const m of mismatches) {
    lines.push(`✗ ${m.action}：同一 Action 的不同子路径用了 ${m.refs.length} 个不同 ref（${m.subpathCount} 个子路径）`)
    for (const g of m.refs) {
      const tail = g.version === '' ? '' : `（${g.version}）`
      lines.push(`    ref=${g.ref}${tail}`)
      for (const u of g.uses)
        lines.push(`      ${u.file}:${u.line}  subpath=${u.subpath === '' ? '(root)' : u.subpath}`)
    }
    lines.push(
      `    修法：把 ${m.action} 的**全部**子路径对齐到同一个 ref（单仓库多 action：同一 commit 即同一版本），` +
        '并把它们纳入同一个 Dependabot group（否则子路径会被当成独立依赖再次单侧 bump）。',
    )
  }
  return lines.join('\n')
}
