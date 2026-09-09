// ── 公式结构渲染（issue #82）：轻量 LaTeX 子集解析器 ─────────────────
// 零运行时依赖（R10）：自实现 tokenize + 递归下降，输出语义化嵌套节点
// （text / seq / frac / sqrt / supsub / big），由 math-render.ts
// 渲染为 <span class="dsh-md-render-*"> 结构。符号映射表见
// math-symbols.ts。回退策略（不误伤）：结构命令（\frac / \sqrt /
// 组 / 上下标）参数不完整时为「全局解析失败」→ 整个公式保持原文；未知
// 命令（\foo）保持原样文本（不报错）。由 syntax.ts（行内）与
// markdown.ts（块级）调用。

interface MathToken {
  t: string
  v?: string
}

// ── tokenizer（纯函数）：\命令 / 花括号组 / ^ _ 上下标 / 字符 / 空白 ──
function tokenizeMath(src: string): MathToken[] {
  const out: MathToken[] = []
  let i = 0
  while (i < src.length) {
    if (src[i] === '\\') i = tokenizeCommand(src, i, out)
    else if (src[i] === '{') {
      out.push({ t: 'lbrace' })
      i += 1
    } else if (src[i] === '}') {
      out.push({ t: 'rbrace' })
      i += 1
    } else if (src[i] === '^' || src[i] === '_') {
      out.push({ t: src[i] === '^' ? 'sup' : 'sub' })
      i += 1
    } else if (/\s/.test(src[i])) {
      out.push({ t: 'space', v: src[i] })
      i += 1
    } else {
      out.push({ t: 'char', v: src[i] })
      i += 1
    }
  }
  return out
}

/** 消费一个 \\命令（或孤立反斜杠）token，返回新的下标。 */
function tokenizeCommand(src: string, i: number, out: MathToken[]): number {
  if (!/[A-Za-z]/.test(src[i + 1] || '')) {
    out.push({ t: 'char', v: '\\' })
    return i + 1
  }
  let j = i + 1
  while (j < src.length && /[A-Za-z]/.test(src[j])) j += 1
  out.push({ t: 'cmd', v: src.slice(i, j) })
  return j
}

interface MathNode {
  t: string
  v?: string
  kids?: MathNode[]
  num?: MathNode
  den?: MathNode
  body?: MathNode
  base?: MathNode | null
  sup?: MathNode | null
  sub?: MathNode | null
  sym?: string
}

interface ParseState {
  p: number
  failed: boolean
}

interface MathParseResult {
  nodes: MathNode[]
  failed: boolean
}

// ── 解析：递归下降，输出节点数组（text / seq / frac / sqrt / supsub / big）──
function parseMath(src: string): MathParseResult {
  const tokens = tokenizeMath(String(src ?? ''))
  const state: ParseState = { p: 0, failed: false }
  const nodes = parseSequence(tokens, state)
  return { nodes, failed: state.failed }
}

/** 追加文本片段到序列末尾（相邻文本合并）。 */
function mergeText(kids: MathNode[], v: string): void {
  const last = kids[kids.length - 1]
  if (last !== undefined && last !== null && last.t === 'text') last.v += v
  else kids.push({ t: 'text', v })
}

/** 读取一个原子（组 / 命令 / 单个字符），供上下标等使用。 */
function readAtom(tokens: MathToken[], state: ParseState): MathNode | null {
  if (state.p >= tokens.length) return null
  const tk = tokens[state.p]
  if (tk.t === 'lbrace') {
    state.p += 1
    return parseGroup(tokens, state)
  }
  if (tk.t === 'cmd') return parseCommand(tokens, state)
  if (tk.t === 'space') {
    state.p += 1
    return readAtom(tokens, state)
  }
  if (tk.t === 'rbrace' || tk.t === 'sup' || tk.t === 'sub') return null
  state.p += 1
  return { t: 'text', v: tk.v }
}

/** 解析序列，直到 token 耗尽或遇 rbrace（组边界）。 */
function parseSequence(tokens: MathToken[], state: ParseState): MathNode[] {
  const kids: MathNode[] = []
  while (state.p < tokens.length) {
    const tk = tokens[state.p]
    if (tk.t === 'rbrace') break
    if (tk.t === 'lbrace') {
      state.p += 1
      kids.push(parseGroup(tokens, state))
    } else if (tk.t === 'cmd') {
      kids.push(parseCommand(tokens, state))
    } else if (tk.t === 'sup' || tk.t === 'sub') {
      applyScript(tokens, state, kids)
    } else if (tk.t === 'space') {
      mergeText(kids, tk.v!)
      state.p += 1
    } else {
      mergeText(kids, tk.v!)
      state.p += 1
    }
  }
  return kids
}

/** 解析花括号组：state.p 位于 lbrace 之后；未闭合 → 全局失败（回退原文）。 */
function parseGroup(tokens: MathToken[], state: ParseState): MathNode {
  const kids = parseSequence(tokens, state)
  if (state.p < tokens.length && tokens[state.p].t === 'rbrace') {
    state.p += 1
  } else {
    state.failed = true
  }
  return kids.length === 1 && kids[0].t !== 'seq' ? kids[0] : { t: 'seq', kids }
}

/** 尝试读花括号参数（跳过空白）；不闭合/不存在 → null（调用方决定失败）。 */
function tryGroup(tokens: MathToken[], state: ParseState): MathNode | null {
  let i = state.p
  while (i < tokens.length && tokens[i].t === 'space') i += 1
  if (tokens[i] === undefined || tokens[i].t !== 'lbrace') return null
  state.p = i + 1
  const kids = parseSequence(tokens, state)
  let closed = false
  if (state.p < tokens.length && tokens[state.p].t === 'rbrace') {
    state.p += 1
    closed = true
  }
  if (!closed) return null
  return kids.length === 1 && kids[0].t !== 'seq' ? kids[0] : { t: 'seq', kids }
}

/** 上下标：把 ^/_ 后的原子绑定到序列末尾元素（supsub）；无 base → 失败回退。 */
function applyScript(tokens: MathToken[], state: ParseState, kids: MathNode[]): void {
  const dir = tokens[state.p].t
  state.p += 1
  const atom = readAtom(tokens, state)
  if (atom === null) {
    state.failed = true
    return
  }
  const last = kids[kids.length - 1]
  if (last !== undefined && last.t === 'supsub') {
    if (dir === 'sup') last.sup = atom
    else last.sub = atom
    return
  }
  const node: MathNode = { t: 'supsub', base: last !== undefined ? kids.pop()! : null, sup: null, sub: null }
  if (dir === 'sup') node.sup = atom
  else node.sub = atom
  if (node.base === null) {
    state.failed = true
    return
  }
  kids.push(node)
}

/** 命令分派（表驱动分支，控制圈复杂度）。state.p 指向 \\命令 token。 */
function parseCommand(tokens: MathToken[], state: ParseState): MathNode {
  const name = tokens[state.p].v!.slice(1)
  state.p += 1
  if (name === 'frac') return parseFrac(tokens, state)
  if (name === 'sqrt') return parseSqrt(tokens, state)
  if (MATH_BIG_SYMS[name] !== undefined) return parseBig(tokens, state, MATH_BIG_SYMS[name])
  if (name === 'left' || name === 'right') return parseDelim(tokens, state)
  if (MATH_TEXT_CMDS.includes(name)) return parseTextCmd(tokens, state)
  const sym = GREEK_COMMANDS[name]
  if (sym !== undefined) return { t: 'text', v: sym }
  const symbol = MATH_SYMBOLS[name]
  if (symbol !== undefined) return { t: 'text', v: symbol }
  const fn = MATH_FUNC_TEXT[name]
  if (fn !== undefined) return { t: 'text', v: fn }
  return { t: 'text', v: '\\' + name }
}

/** 分数：\frac{num}{den}；参数不完整 → 全局失败（整体回退原文）。 */
function parseFrac(tokens: MathToken[], state: ParseState): MathNode {
  const num = tryGroup(tokens, state)
  if (num !== null) {
    const den = tryGroup(tokens, state)
    if (den !== null) return { t: 'frac', num, den }
  }
  state.failed = true
  return { t: 'text', v: '\\frac' }
}

/** 根号：\sqrt{body}；无体 → 全局失败。 */
function parseSqrt(tokens: MathToken[], state: ParseState): MathNode {
  const body = tryGroup(tokens, state)
  if (body !== null) return { t: 'sqrt', body }
  state.failed = true
  return { t: 'text', v: '\\sqrt' }
}

/** 大符号（求和/积分等）：\sum_{sub}^{sup}，上下限可选。 */
function parseBig(tokens: MathToken[], state: ParseState, sym: string): MathNode {
  const sub = tryScript(tokens, state, 'sub')
  const sup = tryScript(tokens, state, 'sup')
  return { t: 'big', sym, sub, sup }
}

/** 尝试读上下限脚本（_{...} 或 ^{...}）；不存在 → null。 */
function tryScript(tokens: MathToken[], state: ParseState, dir: string): MathNode | null {
  let i = state.p
  while (i < tokens.length && tokens[i].t === 'space') i += 1
  if (tokens[i] === undefined || tokens[i].t !== dir) return null
  state.p = i + 1
  return readAtom(tokens, state)
}

/** \left / \right 定界符：后随字符或组按普通文本渲染（不构造结构）。 */
function parseDelim(tokens: MathToken[], state: ParseState): MathNode {
  if (state.p >= tokens.length) return { t: 'text', v: '' }
  const tk = tokens[state.p]
  if (tk.t === 'space') {
    state.p += 1
    return parseDelim(tokens, state)
  }
  if (tk.t === 'char') {
    state.p += 1
    return { t: 'text', v: tk.v }
  }
  if (tk.t === 'cmd') {
    const name = tk.v!.slice(1)
    if (name === 'vert') {
      state.p += 1
      return { t: 'text', v: '|' }
    }
    if (name === 'Vert') {
      state.p += 1
      return { t: 'text', v: '‖' }
    }
    const sym = GREEK_COMMANDS[name] ?? MATH_SYMBOLS[name]
    if (sym !== undefined) {
      state.p += 1
      return { t: 'text', v: sym }
    }
  }
  if (tk.t === 'lbrace') {
    state.p += 1
    return parseGroup(tokens, state)
  }
  return { t: 'text', v: '' }
}

/** 文本命令：\text{...} 参数组按普通文本内联。 */
function parseTextCmd(tokens: MathToken[], state: ParseState): MathNode {
  const body = tryGroup(tokens, state)
  if (body !== null) return body
  return { t: 'text', v: '' }
}

exports.parseMath = parseMath
