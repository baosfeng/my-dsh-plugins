// ── 语法补全（issue #81）：图片 / 任务列表 / 行内元素构造 / 列表解析 ──
// 零运行时依赖（R10）。与 markdown.ts 处于同一 factory 作用域（经
// build.mjs 拼接），函数声明共享：markdown.ts 的 mdInline 与块级
// MD_RENDERERS 调用本文件声明的 inlineMatch / tryList；本文件的 mdInline
// 依赖构造函数（linkEl / mathSpanOrText）与列表解析（listInfo / parseList）。

// ── 图片嵌入：![alt](url) → <img>，alt 兜底 + 加载失败占位 ──────
function MarkdownImage({ src, alt }: { src: string; alt: string }): unknown {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return createElement('span', { className: 'dsh-md-render-img-fallback', role: 'img' }, alt || '图片加载失败')
  }
  return createElement('img', {
    src,
    alt: alt || 'image',
    loading: 'lazy',
    className: 'dsh-md-render-img',
    onError: () => setFailed(true),
  })
}

// ── 任务列表复选框：- [ ] / - [x] → <input type=checkbox> ────────
function TaskCheckbox({ checked }: { checked: boolean }): unknown {
  const [value, setValue] = useState(Boolean(checked))
  return createElement('input', {
    type: 'checkbox',
    className: 'dsh-md-render-task-checkbox',
    checked: value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.currentTarget.checked),
  })
}

// ── 行内元素构造（单分支小函数，控制 mdInline 圈复杂度 ≤ 10）──────
function linkEl(full: string, kk: string): unknown {
  const lm = full.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
  if (lm) {
    return createElement('a', { key: kk, href: lm[2], target: '_blank', rel: 'noreferrer' }, lm[1])
  }
  return full
}

function mathSpanOrText(m: RegExpExecArray, text: string, kk: string): unknown {
  // issue #84：mathStructures 关闭 → 公式语法保持原文（不渲染公式结构）。
  if (!renderOptions.mathStructures) return m[7]
  if (isMathSpan(text, m)) {
    const content = m[7].slice(1, -1)
    const parsed = parseMath(content)
    // issue #82：轻量结构解析成功 → 渲染嵌套结构；解析失败 → 保持原文
    // （不误伤，与 R14 错误标记逻辑兼容——此处仅处理合法公式内容）。
    const kids = parsed.failed ? [content] : mathNodesToReact(parsed.nodes)
    return createElement('span', { key: kk, className: 'dsh-md-render-math' }, ...kids)
  }
  if (isMathError(m)) {
    return createElement(
      'span',
      { key: kk, className: 'dsh-md-render-math-error', title: MATH_ERROR_TITLES.malformed },
      icon.alert(12),
      m[7],
    )
  }
  return m[7]
}

function inlineMatch(m: RegExpExecArray, text: string, kk: string): unknown {
  if (m[1] !== undefined) return createElement('code', { key: kk }, trimCode(m[2]))
  if (m[3] !== undefined) return createElement('strong', { key: kk }, m[3].slice(2, -2))
  if (m[4] !== undefined) return matchImage(m, kk)
  if (m[6] !== undefined) return linkEl(m[6], kk)
  if (m[7] !== undefined) return mathSpanOrText(m, text, kk)
  if (m[8] !== undefined) return matchDel(m, kk)
  return createElement('em', { key: kk }, m[9].slice(1, -1))
}

function matchImage(m: RegExpExecArray, kk: string): unknown {
  // issue #84：image 关闭 → 图片语法保持原文（不解析为 <img>）。
  if (renderOptions.image) return createElement(MarkdownImage, { key: kk, src: m[5], alt: m[4] })
  return m[0]
}

function matchDel(m: RegExpExecArray, kk: string): unknown {
  // issue #84：strikethrough 关闭 → 删除线保持原文（不解析为 <del>）。
  if (renderOptions.strikethrough) return createElement('del', { key: kk, className: 'dsh-md-render-del' }, m[8])
  return m[0]
}

// ── 列表解析（issue #81 增强）：多级嵌套 + 任务列表（- [ ] / - [x]）
//    按缩进层级递归解析 ul / ol（保留层级正确嵌套）；任务标记
//    [ ]/[x]/[X] 渲染 checkbox（勾选态由标记决定）。复用 mdInline。────────
interface ListItemInfo {
  indent: number
  ordered: boolean
  marker: string
  rest: string
  task: boolean
  checked: boolean
}

function listInfo(line: string): ListItemInfo | null {
  const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
  if (!m) return null
  const indent = m[1].length
  const ordered = /^\d/.test(m[2])
  let rest = m[3]
  let task = false
  let checked = false
  // issue #84：taskList 关闭 → 任务标记保持原文（不解析 checkbox）。
  const tm = rest.match(/^\[( |x|X)\]\s+(.*)$/)
  if (tm && renderOptions.taskList) {
    task = true
    checked = tm[1] !== ' '
    rest = tm[2]
  }
  return { indent, ordered, marker: m[2], rest, task, checked }
}

function sameLevel(info: ListItemInfo | null, indent: number, ordered: boolean): boolean {
  // issue #84：nestedList 关闭 → 忽略缩进层级，全部同级渲染（不嵌套）。
  return !!info && info.ordered === ordered && (!renderOptions.nestedList || info.indent === indent)
}

function itemKids(info: ListItemInfo, i: number): unknown[] {
  const kids: unknown[] = []
  if (info.task) kids.push(createElement(TaskCheckbox, { key: 'task' + i, checked: info.checked }))
  kids.push(...mdInline(info.rest, 'li' + i))
  return kids
}

function parseList(lines: string[], start: number): { node: unknown; index: number } {
  const first = listInfo(lines[start])!
  const ordered = first.ordered
  const indent = first.indent
  const items: unknown[] = []
  let i = start
  while (i < lines.length) {
    const info = listInfo(lines[i])
    if (!sameLevel(info, indent, ordered)) break
    const kids = itemKids(info!, i)
    i += 1
    while (i < lines.length) {
      // issue #84：nestedList 关闭 → 不递归解析深层列表（深层项由外层
      // 同级消费，扁平渲染）。
      if (!renderOptions.nestedList) break
      const nxt = listInfo(lines[i])
      if (!nxt || nxt.indent <= indent) break
      const nested = parseList(lines, i)
      kids.push(nested.node)
      i = nested.index
    }
    items.push(createElement('li', { key: items.length }, ...kids))
  }
  return {
    node: createElement(ordered ? 'ol' : 'ul', { className: ordered ? 'tzx-ol' : 'tzx-ul' }, ...items),
    index: i,
  }
}

function tryList(lines: string[], i: number, out: unknown[]): number {
  if (!listInfo(lines[i])) return 0
  const parsed = parseList(lines, i)
  out.push(parsed.node)
  return parsed.index
}
