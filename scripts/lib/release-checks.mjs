/**
 * release-checks.mjs — 发版校验逻辑（issue #39：跨插件依赖校验；issue #72：404 阻断 + server 端扫描；
 * issue #203：源码依赖解析先剔除注释/字符串，消除「注释里的示例 require」假阳性阻断）。
 *
 * 纯函数（无 IO，可单元测试）：
 *   extractDshRequires / findUndeclaredPeers / rangeMin / versionGte / findUnpublishedDeps / isNpmNotFound
 *   tagConflictHint
 * IO 辅助（依赖注入 fs 便于测试）：
 *   collectClientSources / collectServerSources / buildPluginIndex / findFreePort
 *   inspectTagState（git 查询：发版 tag 管理防护）
 *
 * 校验规则（对应 issue #39 期望 1/3 + issue #72 修复）：
 *   1. client/server 端 require('dsh-*') / import 的包必须在 package.json
 *      peerDependencies 或 dependencies 声明；
 *   2. 声明的 dsh-* 依赖中属于本仓库插件的，必须已发布（npm）且版本已打 tag
 *      （<目录>@v<版本>）——依赖先发版、依赖方后发版；
 *   3. npm view 返回 404（包从未发布）必须阻断发版，不再被「已打 tag」兜底放行
 *      （issue #72：dsh-shared 未发布 npm 但 tag 已打，4 个插件安装失败/运行崩溃）。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:net'

// ── 源码依赖解析（issue #203：先剔除注释与字符串再匹配）─────────────────────
// 旧实现在原始源码上直接跑正则，把注释里的示例 require('dsh-md-render')
// （教学插件 dsh-ts-example 的 JSDoc）当成真实依赖 → 假阳性阻断发版。
// 现在先做一遍轻量词法扫描：注释整段丢弃，字符串/模板/正则字面量各自成为一个
// token（内部不再解析），再按 token 序列判定 require / import from。

/** dsh-* 包名（可含子路径），沿用 issue #39 的字符集语义。 */
const DSH_PKG_RE = /^dsh-[A-Za-z0-9._/-]+/

/** 标识符字符（require / from 都是普通标识符，够用即可）。 */
const WORD_CHAR_RE = /[A-Za-z0-9_$]/

/** 这些关键字之后是表达式起始位置：斜杠开始正则字面量而非除法。 */
const REGEX_AFTER_KEYWORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
])

/** 这些标点之后是表达式起始位置（右括号/右方括号/右花括号之后按值结尾处理，见 extractDshRequires 边界说明）。 */
const REGEX_AFTER_PUNCT = new Set([
  '(',
  '[',
  '{',
  ',',
  ';',
  ':',
  '=',
  '!',
  '&',
  '|',
  '?',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '^',
  '~',
])

/** 是否标识符字符。 */
function isWordChar(ch) {
  return WORD_CHAR_RE.test(ch)
}

/** 跳过行注释：返回换行符位置（不含）；无换行则到文件末尾。 */
function skipLineComment(src, i) {
  const nl = src.indexOf('\n', i)
  return nl === -1 ? src.length : nl
}

/** 跳过块注释：返回闭合符之后的位置；未闭合则到文件末尾（截断文件容错）。 */
function skipBlockComment(src, i) {
  const end = src.indexOf('*/', i + 2)
  return end === -1 ? src.length : end + 2
}

/** 注释起点 → 跳过后的位置；不是注释返回 -1。 */
function skipComment(src, i) {
  if (src[i] !== '/') return -1
  if (src[i + 1] === '/') return skipLineComment(src, i)
  if (src[i + 1] === '*') return skipBlockComment(src, i)
  return -1
}

/**
 * 读取字符串/模板字面量：返回 { value, end }（value 为去掉引号的内容）。
 * 单/双引号遇换行即终止（JS 中本就非法），避免未闭合引号把后续真实代码整体吞掉。
 */
function readString(src, i) {
  const quote = src[i]
  const multiline = quote === '`'
  let j = i + 1
  let value = ''
  while (j < src.length) {
    const ch = src[j]
    if (ch === '\\') {
      value += src[j + 1] ?? ''
      j += 2
      continue
    }
    if (ch === quote) return { value, end: j + 1 }
    if (ch === '\n' && !multiline) return { value, end: j }
    value += ch
    j += 1
  }
  return { value, end: j }
}

/** 读取正则字面量：字符类内的斜杠不结束；字面量内含换行视为非法，返回 i + 1（只跳过斜杠）。 */
function readRegex(src, i) {
  let j = i + 1
  let inClass = false
  while (j < src.length) {
    const ch = src[j]
    if (ch === '\\') j += 2
    else if (ch === '\n') return i + 1
    else if (ch === '[') {
      inClass = true
      j += 1
    } else if (ch === ']') {
      inClass = false
      j += 1
    } else if (ch === '/' && !inClass) return j + 1
    else j += 1
  }
  return j
}

/** 斜杠处能否开始正则字面量：由前一个有效 token 决定（边界见 extractDshRequires）。 */
function regexAllowed(last) {
  if (!last) return true
  if (last.type === 'punct') return REGEX_AFTER_PUNCT.has(last.value)
  if (last.type === 'word') return REGEX_AFTER_KEYWORD.has(last.value)
  return false
}

/** 读取标识符/关键字 token。 */
function readWord(src, i) {
  let j = i
  while (j < src.length && isWordChar(src[j])) j += 1
  return { value: src.slice(i, j), end: j }
}

/** 读取字面量 token（字符串 / 正则 / 标识符）；都不是返回 null。 */
function readLiteral(src, i, last) {
  const ch = src[i]
  if (ch === '"' || ch === "'" || ch === '`') {
    const s = readString(src, i)
    return { token: { type: 'string', value: s.value }, end: s.end }
  }
  if (ch === '/' && regexAllowed(last)) {
    const end = readRegex(src, i)
    if (end > i + 1) return { token: { type: 'regex' }, end }
  }
  if (isWordChar(ch)) {
    const w = readWord(src, i)
    return { token: { type: 'word', value: w.value }, end: w.end }
  }
  return null
}

/** 词法扫描：丢弃注释；字符串/正则/标识符各成一个 token，其余按单字符标点。 */
function tokenize(src) {
  const tokens = []
  let i = 0
  while (i < src.length) {
    const commentEnd = skipComment(src, i)
    if (commentEnd !== -1) {
      i = commentEnd
      continue
    }
    if (/\s/.test(src[i])) {
      i += 1
      continue
    }
    const read = readLiteral(src, i, tokens[tokens.length - 1])
    if (read) {
      tokens.push(read.token)
      i = read.end
      continue
    }
    tokens.push({ type: 'punct', value: src[i] })
    i += 1
  }
  return tokens
}

/** 字符串 token 是否为依赖说明符：require( 之后，或 from 之后。 */
function isDependencySpecifier(tokens, i) {
  const prev = tokens[i - 1]
  if (prev?.type === 'word' && prev.value === 'from') return true
  const before = tokens[i - 2]
  return prev?.type === 'punct' && prev.value === '(' && before?.type === 'word' && before.value === 'require'
}

/**
 * 从代码文本提取 require('dsh-*') / from 'dsh-*' 的包名（去重、排序；子路径归为包名）。
 *
 * issue #203：匹配前先做轻量词法扫描（tokenize），注释整段剔除，因此注释里的示例
 * require('dsh-md-render') 不再被当成真实依赖（教学插件 dsh-ts-example 曾因此恒红）。
 *
 * 边界取舍（有意为之，勿在未同步测试的情况下改动）：
 *   1. 注释：行注释与块注释都剔除；未闭合块注释按「到文件末尾」容错，不抛错；
 *   2. 字符串/模板/正则字面量内部不再解析 —— const s = "require('dsh-x')" 这类
 *      示例文本不计入（正是本 issue 的修复目标）；代价是模板插值里的
 *      require('dsh-x') 也不计入（真实依赖不会写在插值里）；
 *   3. 正则字面量靠「前一个 token」启发式识别：等号/左括号/逗号/关键字之后视为
 *      正则，右括号/右方括号/右花括号/标识符之后视为除法；if (x) /['"]/.test(y)
 *      这种「右括号后紧邻正则」的罕见写法会被当作除法，可能影响其后少量文本的
 *      扫描（不影响依赖主路径，也不会漏掉正常写法的 require/import）；
 *   4. 检测面与旧实现一致（未收紧）：仍只认 require(<字面量>) 与 from <字面量>；
 *      动态 import() 与变量 require 本来就不在门禁范围内。
 *
 * @param {string} source 源码文本
 * @returns {string[]} 去重排序后的 dsh-* 包名
 */
export function extractDshRequires(source) {
  const tokens = tokenize(String(source ?? ''))
  const found = new Set()
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.type !== 'string' || !isDependencySpecifier(tokens, i)) continue
    const m = DSH_PKG_RE.exec(token.value)
    if (m) found.add(m[0].split('/')[0])
  }
  return [...found].sort()
}

/** 返回 requires 中未在 peers（peerDependencies）声明的包。 */
export function findUndeclaredPeers(requires, peers) {
  return requires.filter((r) => !(r in peers))
}

/** 从版本范围提取最低版本（^0.1.1 / ~0.1.1 / >=0.1.1 / 0.1.1 → 0.1.1）。 */
export function rangeMin(range) {
  const m = String(range).match(/\d+\.\d+\.\d+/)
  return m ? m[0] : null
}

/** 比较 x.y.z 版本：a >= b（缺位按 0 处理）。 */
export function versionGte(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y
  }
  return true
}

/**
 * 判断 npm view 失败是否为「包未发布」（404 / E404）。
 *
 * issue #72：404 表示 npm 从未发布（依赖方安装/运行必然失败），必须阻断发版；
 * 429 限流等临时错误可走「已打 tag」兜底（发布后可手动重试）。
 */
export function isNpmNotFound(stderr) {
  return /E404|404\s+Not\s+Found/i.test(String(stderr ?? ''))
}

/**
 * 校验声明的 dsh-* 依赖（仓库内插件）是否已发布且已打 tag（发布顺序校验）。
 *
 * @param {object} peers peerDependencies 映射
 * @param {Map<string, {dir: string, version: string}>} pluginIndex 仓库内插件索引
 * @param {(dep: string, range: string) => boolean} isPublished 依赖包是否已发布且满足范围
 * @param {(dir: string, version: string) => boolean} isTagged 依赖包版本是否已打 tag
 * @returns {{dep: string, reason: string}[]} 问题列表（空 = 通过）
 */
export function findUnpublishedDeps(peers, pluginIndex, isPublished, isTagged) {
  const problems = []
  for (const [dep, range] of Object.entries(peers)) {
    const entry = pluginIndex.get(dep)
    if (!entry) continue // 非仓库内插件（官方包）不校验
    if (!isPublished(dep, range)) {
      problems.push({
        dep,
        reason: `依赖包 ${dep} 未发布（npm 上不存在或最新版本 < ${rangeMin(range)}）——依赖必须先发版`,
      })
    } else if (!isTagged(entry.dir, entry.version)) {
      problems.push({
        dep,
        reason: `依赖包 ${dep}（${entry.dir}@v${entry.version}）未打 tag——依赖必须先发版（先发依赖、再发本插件）`,
      })
    }
  }
  return problems
}

/** 收集 client 端源码文件：client.src.js 优先，否则 client.js；附加 lib/parts/*.js。 */
export function collectClientSources(pluginDir) {
  const files = []
  const src = join(pluginDir, 'lib', 'client.src.js')
  const built = join(pluginDir, 'lib', 'client.js')
  if (existsSync(src)) files.push(src)
  else if (existsSync(built)) files.push(built)
  const partsDir = join(pluginDir, 'lib', 'parts')
  if (existsSync(partsDir)) {
    for (const f of readdirSync(partsDir)) {
      if (f.endsWith('.js')) files.push(join(partsDir, f))
    }
  }
  return files
}

/**
 * 收集 server 端源码文件：lib/*.js（排除 client.js / client.src.js 与 parts/ 子目录）。
 *
 * issue #72：跨插件依赖校验原先只扫 client 端（collectClientSources），
 * server 端 import（如 `import ... from 'dsh-shared'`）漏检——dsh-shared
 * 未发布 npm 时 4 个插件发版未被阻断。server 端源码是运行时 import 的
 * 真实依赖，必须纳入扫描。
 */
export function collectServerSources(pluginDir) {
  const libDir = join(pluginDir, 'lib')
  if (!existsSync(libDir)) return []
  return readdirSync(libDir)
    .filter((f) => f.endsWith('.js') && f !== 'client.js' && f !== 'client.src.js')
    .map((f) => join(libDir, f))
    .sort()
}

/** 构建仓库内插件索引：Map<包名, { dir, version }>（包名取自 package.json name）。 */
export function buildPluginIndex(root) {
  const index = new Map()
  for (const entry of readdirSync(join(root, 'plugins'))) {
    const pkgPath = join(root, 'plugins', entry, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    index.set(pkg.name, { dir: entry, version: pkg.version })
  }
  return index
}

/** 从 start 起探测第一个空闲端口（异步）。 */
export function findFreePort(start = 3087) {
  return new Promise((resolve) => {
    const probe = (port) => {
      const server = createServer()
      server.once('error', () => probe(port + 1))
      server.listen(port, () => {
        server.close(() => resolve(port))
      })
    }
    probe(start)
  })
}

/**
 * 查询发版 tag 的状态（tag 管理防护）。
 *
 * 事故背景：release commit 已推 main 但 tag 缺失/指向旧 commit；重跑发版时若直接
 * `git tag` 会失败（已存在）或误覆盖，故先判定状态，由调用方分三支处理：
 *   absent    → refs/tags/<tag> 不存在，正常打 tag；
 *   same-head → 已存在且指向当前 HEAD，跳过打 tag（仅推送，幂等重试）；
 *   conflict  → 已存在但指向其他 commit，调用方必须报错退出，绝不自动 force。
 *
 * 全程 execFileSync 参数数组（不经过 shell）：tag 由外部输入（插件目录名 + 版本）
 * 拼接，避免 CodeQL js/shell-command-injection-from-environment。
 *
 * @param {string} root 仓库根目录
 * @param {string} tag 形如 `<插件目录名>@v<版本>`
 * @returns {{state: 'absent'} | {state: 'same-head'|'conflict', tagSha: string, headSha: string}}
 */
export function inspectTagState(root, tag) {
  let tagSha
  try {
    tagSha = execFileSync('git', ['rev-parse', '-q', '--verify', `${tag}^{commit}`], {
      cwd: root,
      // tag 不存在是正常分支（走打 tag），抑制 git 的 fatal 噪音（stdout 仍需捕获）。
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim()
  } catch {
    return { state: 'absent' }
  }
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  return { state: tagSha === headSha ? 'same-head' : 'conflict', tagSha, headSha }
}

/**
 * conflict 时给人工的处理指引（不提供 --force-tag：删/覆盖 tag 属破坏性操作，
 * 必须由人确认后手动执行，流程不自动 force）。
 */
export function tagConflictHint(tag) {
  return [
    '  可选处理：',
    '  a. 当前 HEAD 即为本次发版内容，删除旧 tag 并重打（远程已存在时需 force 覆盖）：',
    `     git tag -d ${tag} && git tag ${tag} && git push origin -f ${tag}`,
    '  b. 不重打本次：等下一个版本再发（tag 指向旧 commit，本流程不提供 --force-tag 自动覆盖）',
  ]
}
