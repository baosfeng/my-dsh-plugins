// ── 代码块增强（issue #80）：语法高亮 / 语言标签 / 行号 ──────────────
// 零运行时依赖（R10）：自实现轻量单遍 tokenizer（纯函数），按语言拆分
// token 输出 <span class="dsh-md-render-tok-*">；未知语言 / 超长代码块
// （>MAX_CODE_LINES 行）回退纯文本，防卡顿。行号用 CSS counter 伪元素渲
// 染，不进入 code/pre 文本内容，mermaid 扫描与复制按钮读取的原文本
// 不受污染。样式见 styles.ts（随 activation 注入/卸载），语言标
// 签 + 复制按钮共存于代码块头部（header 行）。渲染（语言标签 / 行号 /
// 高亮 token 输出）见 codeblock.ts。

// ── 语言别名 → 规范名（标签用）；未知语言回退纯文本 ──────────────────
const LANG_ALIAS: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  text: 'plain',
  txt: 'plain',
}
function canoLang(lang: string): string {
  const l = String(lang || '').toLowerCase()
  return LANG_ALIAS[l] || l
}
function langLabel(lang: string): string {
  const cfg = langConfig(lang)
  if (cfg) return cfg.label
  const l = String(lang || '')
    .toLowerCase()
    .trim()
  return l === '' || l === 'text' ? 'text' : l
}

// ── 关键字表（常见语言子集）────────────────────────────────────────
const JS_KEYWORDS: readonly string[] = [
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'of',
  'return',
  'set',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
]
const TS_KEYWORDS: readonly string[] = [
  ...JS_KEYWORDS,
  'abstract',
  'any',
  'as',
  'asserts',
  'bigint',
  'boolean',
  'declare',
  'enum',
  'implements',
  'infer',
  'interface',
  'is',
  'keyof',
  'never',
  'number',
  'object',
  'override',
  'private',
  'protected',
  'public',
  'readonly',
  'satisfies',
  'string',
  'symbol',
  'type',
  'unknown',
  'namespace',
  'module',
]
const PY_KEYWORDS: readonly string[] = [
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'False',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'match',
  'None',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'self',
  'True',
  'try',
  'type',
  'while',
  'with',
  'yield',
  'case',
]
const SH_KEYWORDS: readonly string[] = [
  'alias',
  'break',
  'case',
  'cd',
  'chmod',
  'chown',
  'continue',
  'cp',
  'curl',
  'do',
  'done',
  'echo',
  'elif',
  'else',
  'esac',
  'exit',
  'export',
  'fi',
  'for',
  'function',
  'grep',
  'if',
  'local',
  'ls',
  'mkdir',
  'mv',
  'printf',
  'pwd',
  'readonly',
  'return',
  'rm',
  'sed',
  'select',
  'set',
  'shift',
  'source',
  'then',
  'touch',
  'trap',
  'unset',
  'until',
  'wait',
  'while',
]

// ── 语言配置（keywords 关键字表；lineComment 行注释；block 块注释
//    [start,end]；quotes 字符串成对引号；triple 三引号字符串；label 标
//    签显示名）────────────────────────────────────────────────────
interface LangConfig {
  label: string
  keywords: readonly string[]
  lineComment: string | null
  block: [string, string] | null
  quotes: string[]
  triple?: string[]
  markdown?: boolean
}

interface LangConfigResolved extends LangConfig {
  kwSet: Set<string>
}

const LANG_CONFIGS: Record<string, LangConfig> = {
  javascript: {
    label: 'javascript',
    keywords: JS_KEYWORDS,
    lineComment: '//',
    block: ['/*', '*/'],
    quotes: ['"', "'", '`'],
  },
  typescript: {
    label: 'typescript',
    keywords: TS_KEYWORDS,
    lineComment: '//',
    block: ['/*', '*/'],
    quotes: ['"', "'", '`'],
  },
  python: {
    label: 'python',
    keywords: PY_KEYWORDS,
    lineComment: '#',
    block: null,
    quotes: ['"', "'"],
    triple: ['"""', "'''"],
  },
  json: { label: 'json', keywords: [], lineComment: null, block: null, quotes: ['"'] },
  bash: { label: 'bash', keywords: SH_KEYWORDS, lineComment: '#', block: null, quotes: ['"', "'"] },
  yaml: { label: 'yaml', keywords: [], lineComment: '#', block: null, quotes: ['"', "'"] },
  markdown: { label: 'markdown', keywords: [], lineComment: null, block: null, quotes: ['`'], markdown: true },
}
const langConfigCache = new Map<string, LangConfigResolved | null>()
function langConfig(lang: string): LangConfigResolved | null {
  const name = canoLang(lang)
  if (langConfigCache.has(name)) return langConfigCache.get(name)!
  const base = LANG_CONFIGS[name]
  if (!base) return null
  const cfg: LangConfigResolved = { ...base, kwSet: new Set(base.keywords), label: base.label }
  langConfigCache.set(name, cfg)
  return cfg
}

// ── tokenizer（纯函数，单次遍历；输出每行 token 数组）───────────────
const MAX_CODE_LINES = 500
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/

interface Token {
  type: string
  text: string
  blockEnd?: string
}

function tokenizeCode(code: string, lang: string): Token[][] {
  const cfg = langConfig(lang)
  if (!cfg)
    return String(code)
      .split('\n')
      .map((line) => [{ type: 'plain', text: line }])
  if (cfg.markdown) return tokenizeMarkdown(code)
  const state: TokenizeState = { block: null }
  return String(code)
    .split('\n')
    .map((line) => tokenizeLine(line, cfg, state))
}

/** markdown 轻量高亮：行首 # 标题（keyword）+ 行内代码/加粗（string）。 */
function tokenizeMarkdown(code: string): Token[][] {
  return String(code)
    .split('\n')
    .map((line) => {
      const m = /^(#{1,6})(\s+)(.*)$/.exec(line)
      if (m) {
        return [
          { type: 'keyword', text: m[1] },
          { type: 'plain', text: m[2] },
          ...tokenizeLine(m[3], null, { block: null }),
        ]
      }
      return tokenizeLine(line, null, { block: null })
    })
}

interface TokenizeState {
  block: string | null
}

function tokenizeLine(line: string, cfg: LangConfigResolved | null, state: TokenizeState): Token[] {
  const out: Token[] = []
  let rest = line
  while (rest.length > 0) {
    if (state.block) {
      rest = scanBlock(rest, state, out)
      continue
    }
    const t = firstToken(rest, cfg)
    out.push({ type: t.type, text: t.text })
    if (t.blockEnd) state.block = t.blockEnd
    rest = rest.slice(t.text.length)
  }
  return out
}

/** 消费处于块注释/三引号字符串中的剩余行文本，输出对应 token。 */
function scanBlock(rest: string, state: TokenizeState, out: Token[]): string {
  const end = state.block!
  const close = rest.indexOf(end)
  if (close === -1) {
    out.push({ type: 'comment', text: rest })
    return ''
  }
  out.push({ type: 'comment', text: rest.slice(0, close + end.length) })
  state.block = null
  return rest.slice(close + end.length)
}

interface FirstTokenResult {
  type: string
  text: string
  blockEnd?: string
}

function firstToken(rest: string, cfg: LangConfigResolved | null): FirstTokenResult {
  return (
    matchBlock(rest, cfg) ||
    matchLineComment(rest, cfg) ||
    matchString(rest, cfg) ||
    matchNumber(rest) ||
    matchIdent(rest, cfg) || { type: 'plain', text: rest[0] }
  )
}

function matchBlock(rest: string, cfg: LangConfigResolved | null): FirstTokenResult | null {
  if (!cfg || !cfg.block || cfg.block.length !== 2) return null
  const start = cfg.block[0]
  const end = cfg.block[1]
  if (!rest.startsWith(start)) return null
  const close = rest.indexOf(end, start.length)
  if (close === -1) return { type: 'comment', text: rest, blockEnd: end }
  return { type: 'comment', text: rest.slice(0, close + end.length) }
}

function matchLineComment(rest: string, cfg: LangConfigResolved | null): FirstTokenResult | null {
  const lc = cfg && cfg.lineComment
  if (!lc || !rest.startsWith(lc)) return null
  return { type: 'comment', text: rest }
}

function matchString(rest: string, cfg: LangConfigResolved | null): FirstTokenResult | null {
  const quotes = cfg ? cfg.quotes : ['"', "'", '`']
  const ch = rest[0]
  if (!quotes.includes(ch)) return null
  if (cfg && cfg.triple && rest.startsWith(ch + ch + ch)) return matchTriple(rest, ch + ch + ch)
  let j = 1
  while (j < rest.length) {
    if (rest[j] === '\\') {
      j += 2
      continue
    }
    if (rest[j] === ch) return { type: 'string', text: rest.slice(0, j + 1) }
    j += 1
  }
  return { type: 'string', text: rest }
}

function matchTriple(rest: string, triple: string): FirstTokenResult {
  const close = rest.indexOf(triple, triple.length)
  if (close === -1) return { type: 'string', text: rest, blockEnd: triple }
  return { type: 'string', text: rest.slice(0, close + triple.length) }
}

function matchNumber(rest: string): FirstTokenResult | null {
  const m = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)/.exec(rest)
  return m ? { type: 'number', text: m[0] } : null
}

function matchIdent(rest: string, cfg: LangConfigResolved | null): FirstTokenResult | null {
  const m = IDENT_RE.exec(rest)
  if (!m) return null
  const word = m[0]
  const kw = cfg && cfg.kwSet
  if (kw && kw.has(word)) return { type: 'keyword', text: word }
  if (/^\s*\(/.test(rest.slice(word.length))) return { type: 'function', text: word }
  return { type: 'identifier', text: word }
}

exports.tokenizeCode = tokenizeCode
exports.langLabel = langLabel
