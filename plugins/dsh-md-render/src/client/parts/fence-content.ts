// ── 无语言围栏的内容分流：像 markdown 文档 / 像代码 ──────────────────────
// 背景（2026-10-20 真实会话取证）：208 个围栏里 200 个无语言标记（184 个在思考块里），
// 内容是 Kotlin / SQL / shell —— 旧口径「无语言一律 markdown」把代码折叠成一坨。
// 现在先看内容：明显是 markdown 文档才 markdown 化，否则代码卡（等宽、保留换行）。
// 边界：只判「是不是 markdown 文档」（不猜语言、不改写内容）；拿不准一律按代码卡
// （误判成代码只是没美化，误判成 markdown 会破坏代码结构）。判据 = markdown 块级特征
// 加权 ≥ 2 且**零代码特征**。脚本模式片段（无 import/export）。

/** markdown 块级特征（行首，允许 0–3 空格缩进）。 */
const FENCE_MD_HEADING = /^ {0,3}#{1,6}[ \t]+\S/
const FENCE_MD_QUOTE = /^ {0,3}>[ \t]?\S/
const FENCE_MD_LIST = /^ {0,3}(?:[-*+][ \t]+\S|\d{1,9}\.[ \t]+\S)/
/** GFM 表格分隔行：至少两格 `---`，可带 `:` 对齐标记。 */
const FENCE_MD_TABLE_SEP = /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/
/** 首尾都有管道符的表格行。 */
const FENCE_MD_TABLE_ROW = /^ {0,3}\|.*\|[ \t]*$/
/** 分隔线：`***` / `---` / `___`（≥3 个，可夹空格）。 */
const FENCE_MD_THEMATIC = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
/** 行内 markdown 标记（粗体 / 行内代码 / 链接）——弱证据，只在非代码行计入。 */
const FENCE_MD_INLINE = /\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/

/** 代码特征：行首关键字（Kotlin / Java / TS / Python / Go / SQL / shell 的常见开局）。 */
const FENCE_CODE_KEYWORD =
  /^[\t ]*(?:val|var|fun|class|object|interface|private|public|protected|internal|import|package|def|const|let|function|return|if|else|elif|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|yield|async|await|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|System\.|console\.|echo|export|using|struct|enum|namespace|typedef|require|module)\b/
/** 代码特征：注解行（`@Composable` / `@Override` / `@Test` …）。 */
const FENCE_CODE_ANNOTATION = /^[\t ]*@[A-Za-z_]\w*/
/** 代码特征：行尾语句 / 块符号（`;` `{` `}` `=>` `->` `):`）。 */
const FENCE_CODE_TRAIL = /(?:[;{}]|=>|->|\)[ \t]*[:{])[ \t]*$/
/** 代码特征：以 2+ 空格或 tab 开头的续行（markdown 列表行已排除）。 */
const FENCE_CODE_INDENT = /^(?: {2,}|\t)\S/
/** 代码特征：运算符（逻辑 / 比较 / 作用域 / 箭头；`--`、`++` 信号太弱、易与表格分隔线撞车，不计）。 */
const FENCE_CODE_OPERATOR = /(?:&&|\|\||::|=>|->|!==|===|!=|==|\+=|-=)/

/** 单块内容计分（markdown 正分、代码负证据）。 */
interface FenceContentScore {
  markdown: number
  code: number
}

/** 单行命中的 markdown 结构特征（一处判定、两处使用：计分 + 「结构行不参与代码特征」短路）。 */
interface FenceLineKind {
  heading: boolean
  tableSep: boolean
  tableRow: boolean
  quote: boolean
  list: boolean
  thematic: boolean
}

/** 单行 → markdown 结构特征（表格分隔与分隔线互斥：`| --- | --- |` 只算表格分隔）。 */
function classifyMarkdownLine(line: string): FenceLineKind {
  const tableSep = FENCE_MD_TABLE_SEP.test(line)
  return {
    heading: FENCE_MD_HEADING.test(line),
    tableSep,
    tableRow: !tableSep && FENCE_MD_TABLE_ROW.test(line),
    quote: FENCE_MD_QUOTE.test(line),
    list: FENCE_MD_LIST.test(line),
    thematic: !tableSep && FENCE_MD_THEMATIC.test(line),
  }
}

/** 是否 markdown 结构行（是 → 只计正分，**不参与代码特征**）。 */
function isMarkdownStructure(kind: FenceLineKind): boolean {
  return kind.heading || kind.tableSep || kind.tableRow || kind.quote || kind.list || kind.thematic
}

/** 结构行的 markdown 正分（标题与表格分隔是块级强特征，各 2 分）。 */
function markdownScoreOfStructure(kind: FenceLineKind): number {
  let score = 0
  if (kind.heading) score += 2
  if (kind.tableSep) score += 2
  if (kind.tableRow) score += 1
  if (kind.quote) score += 1
  if (kind.list) score += 1
  if (kind.thematic) score += 1
  return score
}

/** 普通行的代码特征分（注解 / 行首关键字 / 行尾符号 / 缩进续行 / 运算符，各自 1 分）。 */
function codeScoreOfLine(line: string): number {
  let score = 0
  if (FENCE_CODE_ANNOTATION.test(line)) score += 1
  if (FENCE_CODE_KEYWORD.test(line)) score += 1
  if (FENCE_CODE_TRAIL.test(line)) score += 1
  if (FENCE_CODE_INDENT.test(line)) score += 1
  if (FENCE_CODE_OPERATOR.test(line)) score += 1
  return score
}

/** 普通行的行内 markdown 弱证据（只在不像代码行时计 1 分）。 */
function inlineMarkdownScoreOfLine(line: string): number {
  if (FENCE_CODE_TRAIL.test(line) || FENCE_CODE_KEYWORD.test(line)) return 0
  return FENCE_MD_INLINE.test(line) ? 1 : 0
}

/** 逐行计分（空行跳过；不看语言、不看代码内容语义）。 */
function scoreFenceContent(source: unknown): FenceContentScore {
  const lines = String(source ?? '').split('\n')
  let markdown = 0
  let code = 0
  for (const line of lines) {
    if (line.trim() === '') continue
    const kind = classifyMarkdownLine(line)
    if (isMarkdownStructure(kind)) {
      // 结构行只计正分：否则表格分隔行 `| --- | --- |` 会被 `--` 类运算符误伤成代码。
      markdown += markdownScoreOfStructure(kind)
      continue
    }
    markdown += inlineMarkdownScoreOfLine(line)
    code += codeScoreOfLine(line)
  }
  return { markdown, code }
}

/**
 * 无语言围栏是否**明显是 markdown 文档**（判据见文件头）：
 * `markdown 分 ≥ 2` 且 **零代码特征**；否则一律按代码卡（保守：不美化也不破坏）。
 */
function fenceLooksLikeMarkdown(source: unknown): boolean {
  const score = scoreFenceContent(source)
  return score.markdown >= 2 && score.code === 0
}

exports.scoreFenceContent = scoreFenceContent
exports.fenceLooksLikeMarkdown = fenceLooksLikeMarkdown
