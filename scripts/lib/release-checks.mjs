/**
 * release-checks.mjs — 发版校验逻辑（issue #39：跨插件依赖校验；issue #72：404 阻断 + server 端扫描；
 * issue #203：源码依赖解析先剔除注释/字符串，消除「注释里的示例 require」假阳性阻断；
 * issue #294：dsh.client.external（跨插件 client 行请求）校验）。
 *
 * 纯函数（无 IO，可单元测试）：
 *   extractDshRequires / findUndeclaredPeers / rangeMin / versionGte / findUnpublishedDeps / isNpmNotFound
 *   listClientExternals / isBaselineModule / checkClientExternals
 *   tagConflictHint
 * IO 辅助（依赖注入 fs 便于测试）：
 *   collectClientSources / collectServerSources / buildPluginIndex / findFreePort
 *   inspectTagState（git 查询：发版 tag 管理防护）
 *
 * 校验规则（对应 issue #39 期望 1/3 + issue #72 修复 + issue #294 修复）：
 *   1. client/server 端 require('dsh-*') / import 的包必须在 package.json
 *      peerDependencies 或 dependencies 声明；
 *   2. 声明的 dsh-* 依赖中属于本仓库插件的，必须已发布（npm）且版本已打 tag
 *      （<目录>@v<版本>）——依赖先发版、依赖方后发版；
 *   3. npm view 返回 404（包从未发布）必须阻断发版，不再被「已打 tag」兜底放行
 *      （issue #72：dsh-shared 未发布 npm 但 tag 已打，4 个插件安装失败/运行崩溃）；
 *   4. dsh.client.external（同 boot 图内的跨插件 client 行请求）必须合规（issue #294，判据于
 *      #439 与官方对齐）：不许重复声明官方 baseline；不许请求仓库内的另一个特性插件
 *      （官方禁止跨插件取值，改用平台 baseline / 注入服务 / slots）；其余包必须声明在
 *      dependencies 或 peerDependencies。自造字段 dsh.client.externalDegraded 已从判据移除。
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

/**
 * dsh.client.external 的修法指引（issue #294；#439 按官方规则重写判据）。
 *
 * external 是「同 boot 图内的跨插件 client 行请求」：只有被请求的包成为 loader entry
 * （⇒ 进入 dsh.profile.bundles）才会产生 client graph row，浏览器端 require 才命中；
 * 缺包时**无 stub、无隔离**，整条 client factory 抛错 → 插件全部 UI 席位挂掉。
 *
 * #439 之后的判据（与官方一致，不再依赖自造字段）：
 *   · 官方 baseline（react / react-dom / cordis / ui-primitives / ui-slots / store / dockkit…）
 *     对每个动态 bundle **隐式可用**，重复声明即违规；
 *   · **仓库内的另一个特性插件**：官方 packages/client/AGENTS.md:37 明令禁止特性插件
 *     runtime-import 彼此的值，也禁止用 dsh.client.external 获取（官方
 *     scripts/verify-client-packages.ts 判违规）——跨包行为走注入的 cordis 服务、
 *     跨包 UI 走 slots、共享渲染组件用平台 baseline；
 *   · 其余（基础设施 / 传输 / 第三方实现库）必须在 dependencies 或 peerDependencies 声明。
 * 旧判据「仅在 peerDependencies 时须声明 dsh.client.externalDegraded」已删除：该字段是宿主
 * 不认的自造字段（宿主只读 platform/inject/external/immediately），且方向与官方相反。
 */
export const CLIENT_EXTERNAL_FIX_HINT = [
  '  修复: 不要用 dsh.client.external 获取另一个特性插件的值（官方明令禁止，packages/client/AGENTS.md:37）:',
  '  1.（推荐）改用平台 baseline 组件 / 能力：宿主 seed 表已提供 react、cordis、',
  '     @deepseek-ai/dsh-client-ui-primitives（MarkdownText 等）、ui-slots、store、dockkit；',
  '     跨包行为走注入的 cordis 服务，跨包 UI 走 slots，共享渲染组件从平台组件库取',
  '     （见 docs/开发指南/官方UI组件库.md）；缺组件时走自己的真降级路径（不要只把',
  '     require 包进 try/catch —— 那是假降级，渲染期照样抛 Element type is invalid）。',
  '  2. 确实需要仓库外的基础设施 / 传输包时，把它写进 dependencies 或 peerDependencies，',
  '     并确认安装路径真的会把它装到用户机器上（profile 模板 autoInstallPeers:false 下 peer 不装）。',
  '  3. 判据与教训见 docs/踩坑/README.md',
].join('\n')

/** 读取 pkg.dsh.client.external 列表（缺失/非数组/非字符串项一律忽略，返回去重结果）。 */
export function listClientExternals(pkg) {
  const external = pkg?.dsh?.client?.external
  if (!Array.isArray(external)) return []
  const names = external.filter((name) => typeof name === 'string' && name !== '')
  return [...new Set(names)]
}

/**
 * 官方 baseline 模块（平台 seed 表 / 隐式可用）判定。
 *
 * 官方 `dsh.client.external` 契约：baseline 对每个动态 bundle **隐式可用**，
 * 不要重复声明（packages/client/AGENTS.md「Baseline externals are implicit」）。
 * 名单与 scripts/check-client-modules.mjs 的 SEED_MODULES 同一来源
 * （docs/开发指南/官方UI组件库.md 的接入契约）。
 */
export function isBaselineModule(specifier) {
  if (specifier === 'react' || specifier === 'react-dom' || specifier.startsWith('react-dom/')) return true
  if (specifier === '@deepseek-ai/cordis') return true
  return specifier.startsWith('@deepseek-ai/dsh-client-')
}

/**
 * 校验 pkg.dsh.client.external（issue #294 起；#439 起与官方规则对齐）。
 *
 * 对每一项断言：
 *   (i)  官方 baseline 模块（react / cordis / ui-primitives / ui-slots / store / dockkit…）
 *        对每个动态 bundle 隐式可用 → **重复声明即阻断**（kind: 'baseline'）；
 *   (ii) 仓库内的另一个特性插件（pluginIndex 命中，即 plugins/*）→ 一律阻断
 *        （kind: 'feature-plugin'）：官方 packages/client/AGENTS.md:37 禁止特性插件
 *        runtime-import 彼此的值，也禁止用 dsh.client.external 获取它们；
 *   (iii) 其余（仓库外的基础设施 / 传输 / 第三方实现库）必须在 dependencies 或
 *        peerDependencies 声明，否则新装用户拿不到该包（kind: 'undeclared'）。
 *
 * 已删除的旧判据：「仅 peerDependencies 时必须声明 dsh.client.externalDegraded」——
 * 该字段官方不认（宿主只读 platform/inject/external/immediately），且它鼓励给跨插件
 * 取值加降级，方向与官方相反。
 *
 * @param {object} pkg 插件 package.json 内容
 * @param {Map<string, {dir: string, version: string}>} pluginIndex 仓库内插件索引
 * @returns {{external: string, kind: 'baseline'|'feature-plugin'|'undeclared', reason: string}[]} 阻断项列表（空 = 通过）
 */
export function checkClientExternals(pkg, pluginIndex) {
  const externals = listClientExternals(pkg)
  if (externals.length === 0) return []
  const deps = pkg?.dependencies ?? {}
  const peers = pkg?.peerDependencies ?? {}
  const problems = []
  for (const external of externals) {
    if (isBaselineModule(external)) {
      problems.push({
        external,
        kind: 'baseline',
        reason: `dsh.client.external 重复声明了官方 baseline 模块 ${external}——baseline 对每个动态 bundle 隐式可用，删掉该声明`,
      })
      continue
    }
    if (pluginIndex.has(external)) {
      problems.push({
        external,
        kind: 'feature-plugin',
        reason:
          `dsh.client.external 请求了仓库内特性插件 ${external}——官方 packages/client/AGENTS.md:37 禁止特性插件 ` +
          `runtime-import 彼此的值、也禁止用 dsh.client.external 获取它们（官方 verify-client-packages.ts 判违规）。` +
          `跨包行为走注入的 cordis 服务、跨包 UI 走 slots、共享渲染组件用平台 baseline（ui-primitives）`,
      })
      continue
    }
    const inDeps = Object.prototype.hasOwnProperty.call(deps, external)
    const inPeers = Object.prototype.hasOwnProperty.call(peers, external)
    if (!inDeps && !inPeers) {
      problems.push({
        external,
        kind: 'undeclared',
        reason: `dsh.client.external 请求了 ${external} 但未在 peerDependencies/dependencies 声明——新装用户拿不到该包，浏览器端 require 落空`,
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
 * 预分配 count 个互不相同的空闲端口（issue #246：批量并行发版时多个隔离实例
 * 必须各占一个端口，否则并行校验会互相抢占——原来每个插件各自 `findFreePort(3087)`，
 * 串行时「碰巧」安全，一并行就会拿到同一个端口）。
 *
 * 逐个探测并递增游标：返回的端口严格递增且互不相同；探测与真正启动之间仍有
 * 极小的被抢占窗口（本机其它进程），因此调用方仍应把端口当作「已尽力预留」。
 *
 * @param {number} start 起始端口
 * @param {number} count 需要的端口个数（<=0 返回空数组）
 * @returns {Promise<number[]>} 升序、互不相同的空闲端口
 */
export async function findFreePorts(start = 3087, count = 1) {
  const ports = []
  if (!Number.isInteger(count) || count <= 0) return ports
  let cursor = Number.isInteger(start) && start > 0 ? start : 3087
  while (ports.length < count) {
    const port = await findFreePort(cursor)
    ports.push(port)
    cursor = port + 1
  }
  return ports
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

/** 包名转正则字面量（版本号里的 `.` 也必须转义，否则会当通配符假通过）。 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 根 README.md 插件表里 <name> 那一行的版本同步正则。
 *
 * prettier 表格按列宽填充空格：表里存在 6 字符版本（如 `0.5.10`）时，5 字符版本
 * 会被写成 `| 0.1.5  |`（版本号**两侧**都有多余空白）。因此这里必须与
 * scripts/check-docs.mjs 的 `\\s*` 口径一致 —— 旧实现只容忍版本号后一个空格
 * （`( ?\\|)`），同步会**静默失败**（调用方只打印「no row」，不报错），随后
 * pre-push 的 docs consistency 门禁把这次 push 拦下。
 */
export function readmeVersionRowRe(name) {
  const esc = escapeRegExp(name)
  return new RegExp(`(\\| \\[${esc}\\]\\(plugins/${esc}/README\\.md\\)\\s+\\|\\s*)\\d+\\.\\d+\\.\\d+(\\s*\\|)`)
}

/**
 * 发版提交计划：待提交文件集合 + commit 消息列表（release.mjs --push 流程用）。
 *
 * `plugins/<name>/package.json` 与 `CHANGELOG.md` **无条件**入列：版本号可能是由
 * **上一次**运行写的（`--bump` 与 `--push` 分两步跑时，本次 `bumped === false`，
 * 但工作区里躺着未提交的版本变更）。旧实现只在 `bumped` 为真时 add，于是
 * 「先 bump 预览、再 push」会漏提交版本变更 —— tag 指向的 commit 里 package.json
 * 仍是旧版本，CI 的「tag 版本 == package.json 版本」校验直接拒绝发布。
 * `git add` 无变更的文件是 no-op，无条件入列不引入噪声。
 */
export function releaseCommitPlan(succeeded, bumpType) {
  const files = new Set(['README.md', 'AGENTS.md'])
  const messages = []
  for (const { name, version, bumped } of succeeded) {
    files.add(`plugins/${name}/package.json`)
    files.add(`plugins/${name}/CHANGELOG.md`)
    // 发版前功能级验证清单（issue #67 留痕）由 3c 阶段生成，必须随发版一起提交：
    // 漏了它，清单就留在工作区**未跟踪**、最终丢失留痕（上一批 2 个插件的清单就是这么丢的）。
    // 存在性由调用方过滤 —— 本函数是纯函数、不做 IO，且 --skip-real-verify 时不生成清单。
    files.add(`verification/${name}-${version}.md`)
    messages.push(
      bumped
        ? `chore(release): ${name} v${version}（自动 bump ${bumpType} + CHANGELOG 生成）`
        : `docs: 同步 ${name} 版本号至 ${version}（发版）`,
    )
  }
  return { files: [...files].sort(), messages }
}

// ── 发版目标版本口径（与 3c 清单名 / git tag 同源）─────────────────────────

/**
 * 解析本次发版的 bump 类型（纯函数）。
 *
 * `--push`（真实发布）时缺省 = `patch`：**发版必须有新的目标版本**。旧行为（缺省恒为 ''）
 * 会让不带 `--bump` 的 `--push` 变成「用当前版本再发一次」—— 实测事故：
 * 未传 `--bump` 的 `--push` 让 version 停在当前版本，tag `<name>@v<当前版本>` 已指向
 * 旧 commit → 发版被拒（`✗ tag 已存在…拒绝覆盖`）；若该 tag 不存在则更糟：同一版本被
 * 重复发布。同时 3c 的清单名会退化成「当前版本」，与历史口径（清单名 = 已发布版本：
 * `dsh-md-render-0.2.0.md` ↔ tag `v0.2.0`）矛盾。
 *
 * dry-run（无 `--push`）保持不 bump —— 与脚本头「dry-run by default」语义一致。
 *
 * @param {{bump?: string, push?: boolean}} [input]
 * @returns {'patch'|'minor'|'major'|''}
 */
export function resolveBumpType({ bump = '', push = false } = {}) {
  if (bump !== '') return bump
  return push ? 'patch' : ''
}

/**
 * 发版产物命名（纯函数）：**清单文件名与 git tag 必须共用同一个发版目标版本**。
 *
 * 抽出来的价值：这两处过去各自拼一次 `${version}`，一旦口径漂移（清单用当前版本、
 * tag 用目标版本）只会在发版中途以 `tag 已存在` 或「清单未勾选」暴露，排查成本高。
 * 现在两者由同一函数产出，单测可直接断言「清单名里的版本 == tag 里的版本」。
 *
 * @param {string} name 插件目录名（如 dsh-my-memory）
 * @param {string} version 发版目标版本（bump 后的 x.y.z）
 * @returns {{checklistPath: string, tag: string}}
 */
export function releaseArtifactNames(name, version) {
  return {
    checklistPath: `verification/${name}-${version}.md`,
    tag: `${name}@v${version}`,
  }
}

/**
 * 构造 3c（真实环境验证）的 verify-real-profile.mjs 命令行参数（纯函数）。
 *
 * 为什么要抽出来：3c 的参数过去**内联在 spawn 调用里** —— 无法单测，新增参数极易漏接线
 * （`--enable-plugins` 就是这么漏掉的：子脚本支持了、门禁没透传，guardian 仍过不了 3c）。
 * 现在参数由本函数产出，单测可断言「未声明时不带该参数」「声明后透传」「声明别的插件不串味」，
 * release.mjs 只负责 spawn。
 *
 * `--enable-plugins` 是**显式**声明（不按插件名自动加）：自动在副本内启用会把「该插件在
 * 生产配置里被故意禁用」这一事实静默抹掉，等于放宽门禁；显式声明要求发版者确认，
 * 且默认一个都不启用（fail-closed）。判据本身不放宽 —— 副本内启用后照样要走
 * 「entry 必须在组合配置中处于启用态」。
 *
 * @param {{checklistPath: string, pluginName: string, version: string, port: number|string, addonDir: string, enablePlugins?: string[]}} input
 * @returns {string[]} argv（不含 node 可执行文件）
 */
export function buildRealVerifyArgs({ checklistPath, pluginName, version, port, addonDir, enablePlugins = [] }) {
  const args = [
    'scripts/verify-real-profile.mjs',
    '--addons',
    addonDir,
    '--port',
    String(port),
    '--checklist',
    checklistPath,
    '--plugin',
    pluginName,
    '--version',
    version,
    '--clean-externals',
  ]
  const enabled = (enablePlugins ?? []).filter((item) => item === pluginName)
  if (enabled.length > 0) args.push('--enable-plugins', enabled.join(','))
  return args
}
