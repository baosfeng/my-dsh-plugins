#!/usr/bin/env node
/**
 * check-doc-api-drift.mjs — 文档-代码漂移门禁（派生文档的 API 面双向校验 + 范例坐标校验）。
 *
 * 背景：docs/官方文档/本仓库重点.md 不是"写出来的文档"，而是**从 plugins/*\/src 实际代码取证
 * 得出的派生文档**——它声明本仓库实际调用哪些宿主能力、哪些事件、哪些 UI 槽位、哪些 API
 * 代码零使用。这类内容靠人工维护必然漂移，典型漂移两类：
 *   ① 文档与 skill 主推代码里零使用的 API（如第三方 ctx.betterSidebar）；
 *   ② 文档写**根本不存在**的 API（如 ctx.config，全仓只在注释里出现；配置入口是
 *      apply(ctx, config) 第二实参）。
 * 所以本门禁的核心价值是让两件事都变红：
 *   · **文档提到代码里不存在的 API**（误导——比"漏登记"更危险，会直接引导写出错代码）；
 *   · **代码新增了 API 但文档没登记**（腐烂——读者据此以为仓库没在用）。
 *
 * 四类判定（任一 finding 即 exit 1）：
 *   1. doc-missing-api / doc-missing-event / doc-missing-slot / doc-missing-field
 *      文档声明了、**剥注释后的代码**里找不到，且不在 INTENTIONALLY_ABSENT 白名单。
 *      剥注释是**必须的**：ctx.config / ctx.events 全仓只出现在注释里，不剥就会把"不存在的
 *      API"判成"代码在用"，本门禁最想抓的那类误导立刻失效（见 stripComments 与单测）。
 *   2. code-undocumented-service / -event / -slot / -field
 *      代码在用、文档未声明，且不在 DOC_OPTIONAL。防「新增 API 没更新文档」。
 *      只有 C 类**真实宿主服务**参与本类报错（HOST_SERVICES）：A 类属性误报静默过滤，
 *      B 类 cordis 通用成员（effect/on/get/emit/inject/logger/root/timer/loader）只打印
 *      提示行、**不阻断**——它们不值得逐条写进那份文档，报了就是刷屏（噪声门禁会被绕过）。
 *   3. bad-example-file / bad-example-line / bad-example-api
 *      文档里的范例坐标 dsh-xxx/src/a.ts:90：文件必须真实存在（相对 plugins/），行号必须在
 *      文件行数内，且该行附近声明的 API token 必须真的出现在那个文件里。**行号允许漂移**
 *      （只校验范围 + 文件确实含该 API），避免每次改代码都红。
 *   4. 同一 API 既在代码又在文档 → 通过。全文无 findings 即打印 ✓ 并 exit 0。
 *
 * 扫描范围与稳定性（CI 可用）：只读仓库内文件——plugins/*\/src/**（排除 node_modules、
 * .stryker-tmp）与各 plugins/*\/package.json，**不依赖 ~/.dsh-refs、不依赖官方仓库检出**。
 *
 * 用法：
 *   node scripts/check-doc-api-drift.mjs               # 仓库自检（CI / 本地门禁）
 *   node scripts/check-doc-api-drift.mjs --json        # 机器可读（单测断言用）
 *   node scripts/check-doc-api-drift.mjs --root <dir>  # 指定仓库根（fixture 单测用）
 *
 * 退出码：0 = 一致；1 = 存在漂移。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 被守护的派生文档（仓库相对路径）。 */
export const DOC_REL = 'docs/官方文档/本仓库重点.md'

/** 扫描时排除的目录：`.stryker-tmp` 是变异测试留下的陈旧代码副本，统计进去必然虚高。 */
const SKIP_DIRS = new Set(['node_modules', '.stryker-tmp', '.git', 'lib', 'dist', 'coverage'])
const SRC_EXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

// ── A. 代码侧口径：哪些 `ctx.X` 不是宿主服务 ────────────────────────────────

/**
 * A 类：**属性访问误报**（不是服务，静默过滤）——这些名字来自"恰好也叫 ctx 的局部变量"
 * （事件过滤器上下文、canvas 2D context、会话标识袋等），实测逐条取证：
 *   extract.ts 的 `ctx.now/sessionId/cwd/candidates/seen/max`、audit-view.ts 的
 *   `ctx.type/start/end/result/keyword`、client 里 canvas 的 `ctx.drawImage`。
 * `config` 也在列：它不是服务（`apply(ctx, config)` 第二实参），且剥注释后已不会出现——
 * 保留在此是为了"万一有人真写下 `ctx.config` 调用"时也能被本门禁抓住（文档已声明它不存在）。
 * 注：`on`/`get`/`emit`/`inject` **不在此列**——它们是 cordis 成员（见 CORDIS_MEMBERS），
 * 需要被记进 members 表（文档写 `ctx.on` 时靠它判定"代码确实有这个成员"）。
 */
export const IGNORE_NON_SERVICE = [
  'candidates',
  'config',
  'cwd',
  'drawImage',
  'end',
  'events',
  'keyword',
  'max',
  'now',
  'result',
  'seen',
  'sessionId',
  'start',
  'type',
]

/**
 * B 类：**cordis 的 ctx 通用成员**（真实能力，但不是"子系统服务"）——参与事件/slot 提取，
 * 但"代码在用文档没写"只提示不阻断（详见文件头 2）。
 */
export const CORDIS_MEMBERS = ['effect', 'on', 'get', 'emit', 'inject', 'logger', 'root', 'timer', 'loader']

/**
 * C 类：**真实宿主服务**（`ctx.get('name')` 可取的子系统）——"代码在用但文档未登记"只对本类报错。
 * 判定依据：官方 `ctx.get` 服务名（含本仓库自研注入的服务名，如 `sidebarRightTabs`）。
 */
export const HOST_SERVICES = [
  'agents',
  'approval',
  'bundler',
  'commands',
  'documentPreviews',
  'goals',
  'llm',
  'pluginInventory',
  'sessionQuery',
  'sessions',
  'sessionTitle',
  'sidebarRight',
  'sidebarRightTabs',
  'skills',
  'slots',
  'systemPrompt',
  'tools',
  'webRuntime',
  'webServer',
]

/**
 * 文档**有意标注为"不存在 / 未使用"**的 token（第一节表格里的"配置入口"行 + 第四节「容易被误导」）
 * ——它们出现在文档里是**故意的**，代码里当然找不到，因此必须白名单化，否则门禁会把自己的
 * 教学内容判成漂移。每条都注明文档里的原话理由；新增条目必须同样带上理由。
 */
export const INTENTIONALLY_ABSENT = [
  // 第四节：「仅见于 skills/plugin-runtime-debug 的描述（方法论仍成立，示例已无对应实现）」
  'inputMachine',
  'facade',
  // 第四节：「全仓 11 处出现全在注释里，真实调用 0……配置入口是 apply(ctx, config) 第二实参」
  'config',
  // 第四节：「14 个 client 插件一律走 exports.inject，没有这种写法」
  'get', // `ctx.get('slots')` 形态（裸 `ctx.get` 本身在 ctx.* 提取里已被排除，这里兜住其调用形态）
  // 第四节：「本仓库设置走 settings.plugins.tab + localStorage，host 半零使用」
  'settings.plugin.item',
  'settings.section',
  'installSection',
  'settingsScope',
  // 第四节：「`ctx.settings` 当前只提供 describe() / openSettingsDocument() / write」——
  // 服务本身存在（packages/api/settings-controller），但本仓库 0 调用，登记为"易误导"项
  'settings',
  // 第一节：「侧边栏页签注册（宿主原生，已弃用第三方 better-sidebar）」
  'betterSidebar',
  // 第三节 3.4：「权威结果在同步的 `tools/result`」是**反面提示**（"在 tools/execute 里取最终结果
  // 拿到旧值"）——本仓库并未监听它；`tools/post-execute` 同理（官方后续阶段，未接）
  'tools/result',
  'tools/post-execute',
  // 第二节：「`todo`（只读 `todo/write` 判未完成）」——文档明确标注"只读"，本仓库不监听该事件
  'todo/write',
  // 第二节同段的一次性订阅：`agent/pre-step` 是 dsh-my-context 的预算拦截点（插件私有用法），
  // `session/created` 只在 dsh-ts-example 演示插件里计数——均为**单个插件的私有订阅**，不进"事件面"总表
  'agent/pre-step',
  'session/created',
  // 第三节 3.3：`dsh.bundle` / `dsh.client` 是**宿主清单的必填基础字段**（官方 DshManifest），
  // 不是本仓库自造约定，因此不逐条登记进"自造字段"一行（登记的是 kind/ui/uiReason/presetReason）
  'bundle',
  'client',
]

/**
 * 代码在用但**不值得写进这份文档**的一次性用法（初值空——当前仓库不存在这种 API）。
 * 新增豁免必须带理由注释，并且要问一句"为什么不写进文档"。
 */
export const DOC_OPTIONAL = []

/**
 * B 类里**只提供方法**、不提供属性的 ctx 成员：`ctx.on(...)` / `ctx.get(...)` / `ctx.emit(...)` /
 * `ctx.inject(...)`。它们是"调用手段"而不是"被调用的能力"，因此：
 *   · 代码侧不单独登记成服务（但文档若写了它们，doc→code 仍按 CORDIS_MEMBERS 集合认定存在）；
 *   · 其余 B 类成员（effect/logger/root/timer/loader）本身就是能力，登记进服务表。
 */
export const METHOD_ONLY_MEMBERS = new Set(['on', 'get', 'emit', 'inject'])

/** 代码侧「服务」的合法名字集 = C 类宿主服务 ∪ B 类中属能力的成员（effect/logger/root/timer/loader）。 */
export const KNOWN_SERVICES = new Set([
  ...HOST_SERVICES,
  ...CORDIS_MEMBERS.filter((m) => !['on', 'get', 'emit', 'inject'].includes(m)),
])

// ── 正则口径 ────────────────────────────────────────────────────────────────

/** slot 名：`a.b.c` 小写点分（`settings.plugins.tab`、`sidebar.right.pane.tab.title`）。 */
const SLOT_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]+){2,}$/
/** 「服务.方法」形态（`ctx.slots.inject` / `slots.register`）：是调用手段，不是槽位名。 */
const SLOT_ACCESSOR_RE = /^(?:ctx\.)?slots\.[A-Za-z_$][A-Za-z0-9_$]*$/
/**
 * 事件名：`<域>/<名>`；域是**事件命名空间**，因此要排除"看起来像路径"的仓库路径前缀
 * （`skills/plugin-runtime-debug` 是 skills 目录，不是事件），以及自研聚合事件的冒号形态。
 */
const EVENT_RE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/
const PLUGIN_EVENT_RE = /^plugin:[a-z][a-z0-9-]*$/
/** 与事件名同形、但不是事件的仓库路径前缀（`skills/<name>`、`docs/<name>`…）。 */
const PATH_LIKE_EVENT_ROOTS = new Set(['skills', 'docs', 'plugins', 'scripts', 'verification', 'node_modules'])

/** 事件名判定（代码侧与文档侧共用同一口径）。 */
export function isEventName(name) {
  const [head] = name.split('/')
  if (PATH_LIKE_EVENT_ROOTS.has(head)) return false
  return EVENT_RE.test(name) || PLUGIN_EVENT_RE.test(name)
}

/**
 * 从一个行内代码 span 里取出**可能是 slot 名**的子串——只取点分连续片段本身
 * （`slots.inject('settings.plugins.tab')` → `settings.plugins.tab`），**不做后缀切分**：
 * 后缀会造出 `right.pane.tab` / `types.d.ts` 这类并不存在的"槽位"，判定时必然误报。
 * 另外把 `ctx.slots.inject` / `slots.register` 这类**服务.方法**形态标出来（它们不是槽位名，
 * 真槽位名在同一段落里显式写出）。
 */
function slotCandidatesIn(span) {
  const out = []
  for (const m of span.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+/g)) {
    if (SLOT_ACCESSOR_RE.test(m[0])) continue // `ctx.slots.inject` / `slots.register`：调用手段
    out.push(m[0])
  }
  return out
}
/** 范例坐标：`dsh-<插件>/src/...:行`（只认本仓库插件前缀，避免官方/宿主路径误入）。 */
const EXAMPLE_RE = /`(dsh-[a-z0-9-]+\/src\/[^\s`]+?\.(?:ts|tsx|d\.ts|js|mjs|jsx))(?::(\d+))?`/g

/**
 * 剥掉 JS/TS 注释（行注释 + 块注释，含 JSDoc）。
 *
 * **这是本门禁的正确性前提，不是优化**：`ctx.config`（11 处）与 `ctx.events` 全仓只出现在
 * 注释里，`ctx.bundler` 则是真实调用。若把注释里的 `ctx.config` 当成"代码在用"，那么文档里
 * 写 `ctx.config` 这类误导就再也抓不到——本门禁要防的第一个真实事故会直接失效。
 *
 * 实现：先用状态机逐字符走一遍（正确处理字符串/模板串/正则字面量里的 `//`、`/*`），
 * 把注释区间替换成等长空白（**保持偏移不变**，行号与列号仍然可用）；
 * 单行 `//` 之外的换行保留，行号因此不漂移。
 */
export function stripComments(code) {
  const out = code.split('')
  let i = 0
  const n = code.length
  // 上一个非空白字符：用于区分正则字面量 `/x/` 与除号
  let prevSignificant = ''
  while (i < n) {
    const c = code[i]
    const c2 = code[i + 1]
    // 字符串 / 模板串：整体跳过（内部不可能有注释起始，但可能有 //）
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      while (i < n) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === quote) {
          i++
          break
        }
        // 模板串里的 ${...} 简单跳过（内含表达式，按普通文本处理即可——注释起始在表达式里极少）
        i++
      }
      prevSignificant = quote
      continue
    }
    // 行注释
    if (c === '/' && c2 === '/') {
      while (i < n && code[i] !== '\n') {
        out[i] = ' '
        i++
      }
      continue
    }
    // 块注释
    if (c === '/' && c2 === '*') {
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] !== '\n') out[i] = ' '
        i++
      }
      if (i < n) {
        out[i] = ' '
        out[i + 1] = ' '
        i += 2
      }
      continue
    }
    // 正则字面量：`= /re/`、`(/re/)`、`, /re/`、`return /re/` 之后才是正则
    if (c === '/' && (prevSignificant === '' || /[=(,:;[!&|?{+\-*%<>~^)\]]/.test(prevSignificant))) {
      i++
      let inClass = false
      while (i < n) {
        const ch = code[i]
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === '\n') break // 不是正则，回退按普通除法处理
        if (ch === '[') inClass = true
        else if (ch === ']') inClass = false
        else if (ch === '/' && !inClass) {
          i++
          break
        }
        i++
      }
      prevSignificant = '/'
      continue
    }
    if (!/\s/.test(c)) prevSignificant = c
    i++
  }
  return out.join('')
}

// ── 工具 ────────────────────────────────────────────────────────────────────

/** 目录递归遍历（只收源码扩展名），排除 SKIP_DIRS。 */
function walkSourceFiles(dir, acc = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walkSourceFiles(p, acc)
    else if (SRC_EXT_RE.test(e.name)) acc.push(p)
  }
  return acc
}

/**
 * 从 `ctx.get('name')` / `ctx.get<X>('name')` 调用里取第一个**字符串字面量**实参。
 * 用 lookahead 要求紧跟引号：`get?.(views, …)` / `get(path, …)`（不是服务读取）因此天然不命中。
 */
function getCallServiceArgs(text) {
  const out = []
  for (const m of text.matchAll(/\.get\s*(?:<[^<>]*>)?\s*\(\s*(?=['"])/g)) {
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 200)
    const first = /^(['"])([^'"]+)\1/.exec(rest)
    if (first) out.push({ name: first[2], index: m.index })
  }
  return out
}

/** 从 `ctx.on('a/b')` / `ctx.emit('a/b')` 调用里取第一个字符串字面量实参（事件名）。 */
function onCallEventNames(text) {
  const out = []
  for (const m of text.matchAll(/\.(?:on|emit)\s*(?:<[^<>]*>)?\s*\(\s*(?=['"])/g)) {
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 200)
    const first = /^(['"])([^'"]+)\1/.exec(rest)
    if (first) out.push({ name: first[2], index: m.index })
  }
  return out
}

/**
 * slot 注册两种写法：`slots.inject('x')` / `slots.register({ name: 'x' })`（取其后首个 `name:`）。
 * `.inject` 只认**单字符串实参**（`slots.inject('settings.plugins.tab')`）——数组形态是
 * cordis 的 `ctx.inject(['service'], cb)` 服务等待，不是 slot（那条走服务提取）。
 */
function slotRegistrations(text) {
  const out = []
  for (const m of text.matchAll(/\.inject\s*\(\s*(?=['"])/g)) {
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 200)
    const first = /^(['"])([^'"]+)\1/.exec(rest)
    if (first) out.push({ name: first[2], index: m.index })
  }
  // register 调用：取其后 600 字符内第一个 `name: '...'`（对象字面量的首个字段就是 name 的写法）
  for (const m of text.matchAll(/\.register\s*\(\s*\{/g)) {
    const rest = text.slice(m.index, m.index + 600)
    const name = /name\s*:\s*(['"])([^'"]+)\1/.exec(rest)
    if (name) out.push({ name: name[2], index: m.index })
  }
  return out
}

/**
 * 服务名全集：cordis 声明式 inject（`exports.inject = [...]`）与 `ctx.inject([...], cb)` 等待。
 * 只收**小写开头的纯标识符**（`webServer`/`documentPreviews`/`agents`）——`@deepseek-ai/x`、
 * `react-dom`、`index.ts`、`README.md`、`Button.tsx` 这类"也是 inject 项但不是服务名"的
 * 字符串被这条口径天然排除（`exports.inject` 里同时还有 `dsh.client.inject` 的包名清单）。
 */
function injectServiceNames(text) {
  const out = []
  const arrayRe = /(?:exports\.inject|\binject)\s*[:=]\s*\[([^\]]*)\]|inject\s*\(\s*\[([^\]]*)\]/g
  for (const m of text.matchAll(arrayRe)) {
    const body = m[1] ?? m[2] ?? ''
    for (const s of body.matchAll(/(['"])([^'"]+)\1/g)) {
      if (/^[a-z][A-Za-z0-9]*$/.test(s[2])) out.push({ name: s[2], index: m.index })
    }
  }
  return out
}

/** 收录一条 token（Map<名字, 首个位置>，name → { file, line }）。 */
function record(map, name, file, line) {
  if (!map.has(name)) map.set(name, { file, line })
}

/** 稳定排序的名字清单。 */
function namesOf(map) {
  return [...map.keys()].sort()
}

// ── A. 提取代码实际 API 面 ──────────────────────────────────────────────────

/**
 * 扫 `plugins/*\/src`（剥注释）与各 `plugins/*\/package.json`，得出代码实际的 API 面。
 * 返回 `{ services, events, slots, fields, members, files }`（前四类是 Map<名, {file,line}>）。
 */
export function buildCodeSurface(root = REPO_ROOT) {
  const services = new Map()
  const events = new Map()
  const slots = new Map()
  const fields = new Map()
  const members = new Map()
  const ignore = new Set(IGNORE_NON_SERVICE)
  const cordis = new Set(CORDIS_MEMBERS)
  let files = 0

  const pluginsDir = join(root, 'plugins')
  let pluginDirs = []
  try {
    pluginDirs = readdirSync(pluginsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    pluginDirs = []
  }

  for (const name of pluginDirs) {
    const pkgPath = join(pluginsDir, name, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        // 自造字段：dsh.* 的**顶层键名**（文档用 `dsh.kind` / `dsh.client.externalDegraded`
        // 这类点分路径书写；嵌套子键不逐条登记，判定时按首段匹配即可——见 evaluate 的字段口径）
        for (const k of Object.keys(pkg.dsh ?? {})) {
          record(fields, k, `plugins/${name}/package.json`, 1)
        }
      } catch {
        /* 坏 JSON 交给别的门禁报，这里不重复 */
      }
    }

    const srcDir = join(pluginsDir, name, 'src')
    if (!existsSync(srcDir)) continue
    for (const abs of walkSourceFiles(srcDir)) {
      files++
      const rel = `plugins/${name}/src/${abs.slice(srcDir.length + 1)}`
      const raw = readFileSync(abs, 'utf8')
      const code = stripComments(raw)
      const lineOf = (idx) => raw.slice(0, idx).split('\n').length

      // 宿主服务与 cordis 成员：ctx.<name>
      // 只收「C 类宿主服务」与「B 类 cordis 成员」两个已知名字集——不在集合里的 ctx.X
      // 是"恰好也叫 ctx 的局部变量"（A 类误报），既不进服务表也不报错。
      for (const m of code.matchAll(/ctx\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        const n = m[1]
        if (ignore.has(n)) continue
        if (cordis.has(n)) record(members, n, rel, lineOf(m.index))
        else if (KNOWN_SERVICES.has(n)) record(services, n, rel, lineOf(m.index))
      }
      // 事实上的能力面：B 类里"只提供方法"的成员（on/get/emit/inject）不算能力，
      // 其余 B 类成员（effect/logger/root/timer/loader）本身就是能力 → 并入服务表。
      for (const n of members.keys()) {
        if (!METHOD_ONLY_MEMBERS.has(n)) record(services, n, rel, 1)
      }
      // ctx.get('name') 也是服务（取字符串字面量实参；cordis 成员名归 members）
      for (const { name: s, index } of getCallServiceArgs(code)) {
        if (ignore.has(s)) continue
        if (cordis.has(s)) {
          record(members, s, rel, lineOf(index))
          continue
        }
        if (!KNOWN_SERVICES.has(s)) continue
        record(services, s, rel, lineOf(index))
      }
      // 声明式 / 局部等待的 inject 服务（`commands` 这类只经 ctx.inject(['commands'], cb) 拿到的服务）
      for (const { name: s, index } of injectServiceNames(code)) {
        if (ignore.has(s) || cordis.has(s)) continue
        if (!KNOWN_SERVICES.has(s)) continue
        record(services, s, rel, lineOf(index))
      }
      // 事件名
      for (const { name: ev, index } of onCallEventNames(code)) {
        if (isEventName(ev)) record(events, ev, rel, lineOf(index))
      }
      // slot 名：`slots.inject('a.b.c')` / `slots.register({ name: 'a.b.c' })`，
      // 以及带具体类型标注的 `ctx.slots.inject<T>('a.b.c')` 变体
      for (const m of code.matchAll(/\.inject\s*(?:<[^<>]*>)?\s*\(\s*(?=['"])/g)) {
        const rest = code.slice(m.index + m[0].length, m.index + m[0].length + 200)
        const first = /^(['"])([^'"]+)\1/.exec(rest)
        if (first && SLOT_RE.test(first[2])) record(slots, first[2], rel, lineOf(m.index))
      }
      for (const { name: s, index } of slotRegistrations(code)) {
        if (SLOT_RE.test(s)) record(slots, s, rel, lineOf(index))
      }
    }
  }

  return { services, events, slots, fields, members, files }
}

// ── B. 提取文档声明 ────────────────────────────────────────────────────────

/** 收集 markdown 里的行内代码 span（`` `...` ``），含 1-based 行号；跳过围栏代码块内部。 */
export function inlineCodeSpans(text) {
  const lines = text.split('\n')
  const spans = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      spans.push({ text: m[1], line: i + 1 })
    }
  }
  return spans
}

/**
 * 从文档提取声明。返回：
 *   services/events/slots/fields : Map<名, 1-based 行号>
 *   examples                     : [{ path, line, docLine, tokens }]（范例坐标 + 同行 API token）
 *   section1                     : 第一节文本（子串，用于 bare service 名解析）
 */
export function parseDoc(text) {
  const services = new Map()
  const events = new Map()
  const slots = new Map()
  const fields = new Map()
  const examples = []
  const lines = text.split('\n')

  // 第一节范围：`## 一、` 到下一个 `## `
  const s1Start = lines.findIndex((l) => /^##\s*一、/.test(l))
  const s1End = s1Start < 0 ? -1 : lines.findIndex((l, i) => i > s1Start && /^##\s/.test(l))
  const section1 = s1Start < 0 ? '' : lines.slice(s1Start, s1End < 0 ? lines.length : s1End).join('\n')

  const absorb = (map, name, line) => {
    if (!map.has(name)) map.set(name, line)
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const lineText = lines[i]
    // 同一行的 API token（用于范例坐标的"文件里确实含该 API"判定）
    const rowTokens = []

    for (const m of lineText.matchAll(/`([^`\n]+)`/g)) {
      const span = m[1]

      // ctx.X（去重保留首个）：跳过 `ctx.get('slots')` 这种带引号的（⇒ INTENTIONALLY_ABSENT 形态）
      for (const t of span.matchAll(/\bctx\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        const n = t[1]
        // `ctx.get('slots')` 的 "()" 特例：裸 `ctx.get` 之外的调用形态不算服务声明
        if (n === 'get' && /\.get\s*\(/.test(span)) continue
        absorb(services, n, lineNo)
        rowTokens.push(n)
      }
      // ctx.get('name') / ctx.get<X>('name')
      for (const { name: n } of getCallServiceArgs(span)) {
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) continue
        absorb(services, n, lineNo)
        rowTokens.push(n)
      }
      // 事件名（与代码侧同一口径：排除 `skills/x` 这类路径形态）
      if (isEventName(span)) {
        absorb(events, span, lineNo)
        rowTokens.push(span)
      }
      // slot 名：span 整体是 slot 名，或 span 里嵌着一个 slot 名（`ctx.slots.inject` /
      // `slots.inject('settings.plugins.tab')` 都要能取到）
      for (const cand of [span, ...slotCandidatesIn(span)]) {
        if (!SLOT_RE.test(cand)) continue
        absorb(slots, cand, lineNo)
        rowTokens.push(cand)
      }
      // `slots.inject('a.b.c')` / `slots.register({ name: 'a.b.c' })`：文档直接点名了槽位
      for (const m of span.matchAll(/\.inject\s*(?:<[^<>]*>)?\s*\(\s*(['"])([^'"]+)\1/g)) {
        if (!SLOT_RE.test(m[2])) continue
        absorb(slots, m[2], lineNo)
        rowTokens.push(m[2])
      }
      for (const m of span.matchAll(/\.register\s*\(\s*\{[^}]*?name\s*:\s*(['"])([^'"]+)\1/g)) {
        if (!SLOT_RE.test(m[2])) continue
        absorb(slots, m[2], lineNo)
        rowTokens.push(m[2])
      }
      // `ctx.slots.inject` 这类"服务.方法"形态：真正被声明的槽位在同段落里显式写出
      for (const m of span.matchAll(/\b(?:ctx\.)?slots\.\w+/g)) {
        rowTokens.push(m[0])
      }
      // 自造字段 dsh.X / dsh.X.Y
      for (const t of span.matchAll(/\bdsh\.([A-Za-z_$][A-Za-z0-9_$.]*)/g)) {
        const n = t[1].replace(/=.*$/, '')
        absorb(fields, n, lineNo)
        rowTokens.push(`dsh.${n}`)
      }
    }

    // 范例坐标
    for (const m of lineText.matchAll(EXAMPLE_RE)) {
      examples.push({
        path: m[1],
        line: m[2] ? Number(m[2]) : null,
        docLine: lineNo,
        tokens: rowTokens,
      })
    }
  }

  // 第一节课文里裸写的服务名（如 `ctx.get(name, false)` 后列举的 `slots` `webRuntime` …）：
  // 只在 C 类宿主服务清单内认，避免把 `list`/`keyed` 这类英文词当 API 名
  for (const m of section1.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)`/g)) {
    const n = m[1]
    if (!HOST_SERVICES.includes(n)) continue
    absorb(services, n, 1)
  }

  return { services, events, slots, fields, examples, section1 }
}

// ── C. 判定 ────────────────────────────────────────────────────────────────

/**
 * 白名单匹配：`ctx.X` 按去掉前缀的短名比对（文档里的写法可能带 `ctx.`，白名单写短名），
 * `ctx.get('slots')` 这类带调用形态的条目也能命中其首个实参名。
 */
function isWhitelisted(name, list = INTENTIONALLY_ABSENT) {
  const short = name.replace(/^ctx\./, '')
  return list.some((w) => {
    if (w === name || w === short || w === `ctx.${name}`) return true
    const m = /^ctx\.\w+\(\s*'([^']+)'/.exec(w)
    return m ? m[1] === short : false
  })
}

/**
 * 纯函数判定：给定代码 API 面与文档声明，返回 findings 数组（空数组 = 一致）。
 * 单测直接注入两侧数据，不依赖真实仓库。
 */
export function evaluate({ code, doc }) {
  const findings = []
  const docRel = code.docRel ?? DOC_REL

  // 1. 文档提到 → 代码没有（本门禁核心价值）
  const docKinds = [
    ['services', 'doc-missing-api', '宿主能力'],
    ['events', 'doc-missing-event', '事件'],
    ['slots', 'doc-missing-slot', 'UI 槽位'],
    ['fields', 'doc-missing-field', '自造字段'],
  ]
  for (const [key, kind, label] of docKinds) {
    for (const [name, line] of doc[key]) {
      if (code[key].has(name)) continue
      // 「服务.方法」形态不是槽位名：`ctx.slots.inject` 说的是"必须用 inject 这个手段"，
      // 真正声明的槽位名在同一段落里（`settings.plugins.tab`），不在这里误判
      if (key === 'slots' && SLOT_ACCESSOR_RE.test(name)) continue
      // B 类 cordis 成员（`ctx.on` / `ctx.emit` / `ctx.effect` …）在代码侧进 members 表：
      // 文档写它们是合理的"能力登记"，只要代码里真有这个成员就算一致。
      if (key === 'services' && code.members?.has?.(name)) continue
      if (isWhitelisted(name)) continue
      // 字段用点分路径书写（`dsh.client.externalDegraded`）：按首段比对顶层键
      if (key === 'fields' && code.fields.has(name.split('.')[0])) continue
      findings.push({
        kind,
        file: docRel,
        line,
        target: name,
        detail: `文档声明${label} \`${name}\`，但剥注释后的 plugins/*/src 里找不到任何使用（若确实不存在：改文档；若确实存在但只在注释里：那是误导，必须改文档或登记 INTENTIONALLY_ABSENT）`,
      })
    }
  }

  // 2. 代码在用 → 文档没写（只对 C 类真实宿主服务 + 事件 + 槽位 + 自造字段阻断）
  const codeKinds = [
    ['services', 'code-undocumented-service', '宿主服务'],
    ['events', 'code-undocumented-event', '事件'],
    ['slots', 'code-undocumented-slot', 'UI 槽位'],
    ['fields', 'code-undocumented-field', '自造字段'],
  ]
  for (const [key, kind, label] of codeKinds) {
    for (const [name, loc] of code[key]) {
      if (doc[key].has(name)) continue
      if (key === 'services' && !HOST_SERVICES.includes(name)) continue // A/B 类不阻断
      // 白名单同时服务两个方向：`INTENTIONALLY_ABSENT` 里的是"确实存在但文档有意不登记"
      // （`dsh.bundle` / `agent/pre-step` 这类），不该在反向再报一次
      if (isWhitelisted(name) || DOC_OPTIONAL.includes(name)) continue
      findings.push({
        kind,
        file: loc.file,
        line: loc.line,
        target: name,
        detail: `代码在用的${label} \`${name}\` 未登记到 ${docRel}（${loc.file}:${loc.line}）——请在第一节表格加一行（能力 / 用途 / 范例 / 官方页）；确实不值得写进文档的登记 DOC_OPTIONAL`,
      })
    }
  }

  // 3. 范例坐标：文件必须存在 + 行号在范围内 + 文件里确实含该行声明的 API
  for (const ex of doc.examples ?? []) {
    const base = code.root ?? REPO_ROOT
    // 基准：相对 plugins/（文档惯例）优先，其次相对仓库根
    const candidates = [join(base, 'plugins', ex.path), join(base, ex.path)]
    const useAbs = candidates.find((p) => existsSync(p))
    if (!useAbs) {
      findings.push({
        kind: 'bad-example-file',
        file: docRel,
        line: ex.docLine,
        target: ex.path,
        detail: `范例坐标 \`${ex.path}\` 指向的文件不存在（按 plugins/ 与仓库根两种基准都找不到）——改成真实存在的文件`,
      })
      continue
    }
    const src = readFileSync(useAbs, 'utf8')
    const total = src.split('\n').length
    if (ex.line !== null && (ex.line < 1 || ex.line > total)) {
      findings.push({
        kind: 'bad-example-line',
        file: docRel,
        line: ex.docLine,
        target: `${ex.path}:${ex.line}`,
        detail: `范例行号 ${ex.line} 超出文件行数（${total} 行）——行号允许小幅漂移，但不能指向文件外`,
      })
      continue
    }
    const names = (ex.tokens ?? []).map((t) => t.replace(/^dsh\./, '').split('.')[0])
    const unique = [...new Set(names.filter((t) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)))]
    if (unique.length === 0) continue // 该行没声明 API（纯任务映射表），只校验文件存在
    const hit = unique.some((t) => new RegExp(`\\b${t}\\b`).test(src))
    if (!hit) {
      findings.push({
        kind: 'bad-example-api',
        file: docRel,
        line: ex.docLine,
        target: ex.path,
        detail: `范例坐标 \`${ex.path}\` 所在行声明的 API（${unique.join(' / ')}）在该文件里一个都找不到——范例指错了文件`,
      })
    }
  }

  return findings
}

// ── D. 报告 ────────────────────────────────────────────────────────────────

const FIX_HINT = `修复指引（按 kind 对号入座）：
  · doc-missing-api / -event / -slot / -field
      文档提到了代码里不存在的 API → 改 ${DOC_REL} 对应小节（第一节能力表 / 第四节误导清单），
      或（若属"有意标注为不存在"）登记 scripts/check-doc-api-drift.mjs 的 INTENTIONALLY_ABSENT。
  · code-undocumented-service / -event / -slot / -field
      代码新增了 API 而文档没登记 → 在 ${DOC_REL} 第一节表格加一行（能力 / 本仓库拿它干什么 /
      范例 path:line / 官方权威页）；确实不值得写进文档的登记 DOC_OPTIONAL。
  · bad-example-file / -line / -api
      范例坐标失效 → 改 ${DOC_REL} 里该范例的路径/行号（行号允许漂移，只需落在文件内且
      该文件确实含所声明的 API）。`

/** 渲染人类可读报告；返回文本（调用方决定 stdout/stderr 与退出码）。 */
export function renderReport(result) {
  const { findings, stats, members } = result
  if (findings.length === 0) {
    const hint =
      members.length > 0 ? `（另有 ${members.length} 个 cordis 通用成员未逐条登记：${members.join(' ')}）` : ''
    return `✓ 文档-代码 API 面一致（${stats.docDeclarations} 条声明 / ${stats.codeApis} 个实际 API）${hint}`
  }
  const lines = [`文档-代码 API 漂移（${findings.length} 项）：`]
  for (const f of findings) {
    lines.push(`❌ ${f.file}:${f.line} ${f.detail}`)
  }
  lines.push(FIX_HINT)
  return lines.join('\n')
}

/** 汇总一次完整校验（供 CLI 与单测共用）。`docRel` 允许 fixture 指向简化的文档路径。 */
export function runCheck({ root = REPO_ROOT, docRel = DOC_REL } = {}) {
  const docPath = join(root, docRel)
  if (!existsSync(docPath)) throw new Error(`找不到被守护的文档：${docRel}`)
  const docText = readFileSync(docPath, 'utf8')
  const code = buildCodeSurface(root)
  const doc = parseDoc(docText)
  const findings = evaluate({ code: { ...code, root, docRel, members: new Set(namesOf(code.members)) }, doc })
  const stats = {
    docDeclarations: doc.services.size + doc.events.size + doc.slots.size + doc.fields.size,
    codeApis: code.services.size + code.events.size + code.slots.size + code.fields.size,
    codeFiles: code.files,
    examples: doc.examples.length,
  }
  return {
    findings,
    stats,
    members: namesOf(code.members),
    services: { code: namesOf(code.services), doc: namesOf(doc.services) },
    events: { code: namesOf(code.events), doc: namesOf(doc.events) },
    slots: { code: namesOf(code.slots), doc: namesOf(doc.slots) },
    fields: { code: namesOf(code.fields), doc: namesOf(doc.fields) },
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { json: false, root: REPO_ROOT }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (a === '--root') opts.root = argv[++i]
    else if (a.startsWith('--root=')) opts.root = a.slice('--root='.length)
  }
  return opts
}

/** 是否作为 CLI 直接运行（被 vitest import 时不执行）。 */
const isMain = (() => {
  try {
    return process.argv[1] && statSync(process.argv[1]).isFile() && import.meta.url === `file://${process.argv[1]}`
  } catch {
    return false
  }
})()

if (isMain) {
  const opts = parseArgs(process.argv.slice(2))
  let result
  try {
    result = runCheck({ root: opts.root })
  } catch (err) {
    if (opts.json) {
      console.log(JSON.stringify({ findings: [{ kind: 'fatal', detail: String(err?.message ?? err) }] }, null, 2))
    } else {
      console.error(`❌ ${String(err?.message ?? err)}`)
    }
    process.exit(1)
  }
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else if (result.findings.length === 0) {
    console.log(renderReport(result))
  } else {
    console.error(renderReport(result))
  }
  process.exit(result.findings.length === 0 ? 0 : 1)
}
