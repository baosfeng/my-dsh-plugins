/**
 * verify-profile.mjs — 隔离 profile 复刻的插件软链策略与解析路径校验（issue #220）。
 *
 * 背景（假验证事故）：verify-real-profile.mjs 复刻生产 profile 时，先把真实
 * profile 的 node_modules 条目**全量软链**进模拟目录，再补 --addons 的软链；
 * 旧实现在「同名条目已存在」时直接复用真实 profile 的软链 → 隔离实例加载的是
 * **主工作区版本**而不是待验的 addon：
 *
 *   - 假通过：验证"跑过了"，但验的不是待验代码 → 未验证的修复被当成已验证；
 *   - 假失败：反过来让 agent 以为"改动无效"，去改本来正确的代码（白跑数轮）。
 *
 * 本模块是该流程的唯一实现（脚本只做接线，逻辑可单测）：
 *
 *   1. planNodeModulesLinks —— 链接计划：--addons 显式指定的条目**必须**指向
 *      addon 目录（覆盖真实 profile 的同名软链）；未指定的条目照旧复用真实
 *      profile（保住 pnpm 依赖解析，未指定 addons 时既有行为零回归）；
 *      omit（issue #294）里的条目一律不链接 —— external 缺包演练；
 *   2. linkNodeModules —— 应用计划（真实 fs；重写软链，不污染真实 profile）；
 *   3. checkAddonResolution —— realpath 解析校验（fail-closed：脚本在实例启动前
 *      打印并断言）。比较一律用 realpath：macOS 上 /tmp 是 /private/tmp 的软链，
 *      直接比字符串会把正确链接误判成错误、把错误链接误判成正确；
 *   4. checkOmittedAbsent —— omit 条目必须真的不可解析（issue #294 第二层防线）；
 *   5. readAddonExternals —— 读插件 dsh.client.external（推导缺包演练集合）；
 *   6. buildWorkspaceStorage / validateWorkspaceStorage / writeWorkspaceStorage
 *      —— 预置隔离实例的工作区落盘状态。storages/workspace.json 有**隐性 Zod
 *      校验**（unit 头 + ISO 时间戳 + path 必须是 realpath），格式错误会让实例
 *      启动即失败，故写入后回读校验（fail-closed）。
 */
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'

// ── 文件读取（fd 化，消 CodeQL js/file-system-race） ──────────────────────

/**
 * 按 **fd** 读文本；文件不存在（`ENOENT`）返回 null，其它错误原样抛出。
 *
 * 为什么不用 `existsSync(p) ? readFileSync(p, 'utf8') : null`：那是按**路径名**先检查、
 * 再按路径名使用 —— 两次系统调用之间文件可被替换/删除（TOCTOU，CWE-367），CodeQL
 * `js/file-system-race`（security_severity=high）正是报这个（告警 #118 命中
 * `verify-real-profile.mjs` 的 `writeFileSync(patchPath, …)`）。仓库既有惯例是
 * `openSync` 拿 fd 直接读（见 `scripts/check-links.mjs`、`scripts/fork-pool.mjs`）。
 */
export function readTextIfExists(path) {
  let fd = null
  try {
    fd = openSync(path, 'r')
    return readFileSync(fd, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

// ── 插件条目与软链计划 ─────────────────────────────────────────────────────

/** 读取 addon 目录的 profile node_modules 条目名（package.json name 优先，回落目录名）。
 *  dir 统一取 realpath：macOS 上 /tmp 是 /private/tmp 的软链，未规范化的路径会让
 *  软链目标与解析校验的期望值对不上（issue #220 的同类坑）。 */
export function readAddon(dir) {
  const abs = resolve(dir)
  const pkgPath = join(abs, 'package.json')
  if (!existsSync(pkgPath)) return null
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const name = typeof pkg.name === 'string' && pkg.name !== '' ? pkg.name : basename(abs)
  return { dir: realpathOrNull(abs) ?? abs, name }
}

/**
 * 计算模拟 profile 的 node_modules 链接计划（纯函数，无 IO）。
 *
 * 规则：**显式指定（--addons）优先于复用真实 profile**（issue #220 的核心）；
 * 未被 addon 指定的条目照旧复用；addon 是 scoped 包时其 scope 目录必须展开
 * （真实 profile 的 scope 目录整体软链会让子条目写入落到真实 profile 里）。
 *
 * issue #294：omit 是「external 缺包」演练——列在 omit 里的条目**一律不链接**
 * （既不复用真实 profile，也不做 addon 链接）。这正是新装用户拿不到
 * dsh.client.external 依赖时的实例状态；不 omit 则本机已装该包，缺陷永远
 * 不可能被验证到（结构性假通过）。omit 与 addon 同名时 omit 优先并记录
 * omittedAddons（调用方必须打印，不静默）。
 *
 * @param {{realEntries: string[], addons: Array<{dir: string, name: string}>, omit?: string[]}} input
 * @returns {{reuse: string[], expand: string[], addonLinks: Array<{entry: string, dir: string}>, overridden: string[], omitted: string[], omittedAddons: string[]}}
 */
export function planNodeModulesLinks({ realEntries, addons, omit = [] }) {
  const omitSet = new Set(omit)
  const requested = addons.map((addon) => ({ entry: addon.name, dir: addon.dir }))
  const omittedAddons = requested.filter((link) => omitSet.has(link.entry)).map((link) => link.entry)
  const addonLinks = requested.filter((link) => !omitSet.has(link.entry))
  const addonEntries = new Set(addonLinks.map((link) => link.entry))
  const scopes = new Set()
  for (const entry of addonEntries) {
    if (entry.startsWith('@') && entry.includes('/')) scopes.add(entry.split('/')[0])
  }
  // issue #294：omit 的 scoped 包同样要求展开 scope 目录 —— 否则整目录软链会把
  // 被省略的包一起带进隔离实例（缺包演练失效，且 checkOmittedAbsent 会误报 leak）。
  for (const entry of omitSet) {
    if (entry.startsWith('@') && entry.includes('/')) scopes.add(entry.split('/')[0])
  }
  const reuse = []
  const expand = []
  const omitted = []
  for (const entry of realEntries) {
    if (addonEntries.has(entry)) continue // addon 显式指定 → 不复用真实 profile 条目
    if (omitSet.has(entry)) {
      omitted.push(entry) // issue #294：缺包演练 → 真实 profile 里也不复用
      continue
    }
    if (scopes.has(entry)) {
      expand.push(entry) // scope 目录整体软链会让 addon 写入污染真实 profile → 展开
      continue
    }
    reuse.push(entry)
  }
  return {
    reuse,
    expand,
    addonLinks,
    overridden: realEntries.filter((entry) => addonEntries.has(entry)),
    omitted,
    omittedAddons,
  }
}

/**
 * 读取 addon 插件声明的 dsh.client.external（issue #294）。
 *
 * --clean-externals 用它自动推导「缺包演练」集合：external 是「同 boot 图内的跨插件
 * client 行请求」，新装用户若没装这些包，浏览器端 require 就落空（整条 client factory
 * 抛错、插件全部 UI 席位挂掉）。隔离实例必须**能复现**这个状态，否则验证永远是假通过。
 * 缺失/非数组/非法项一律忽略（与 release 门禁的 listClientExternals 同口径）。
 */
export function readAddonExternals(dir) {
  const pkgPath = join(resolve(dir), 'package.json')
  if (!existsSync(pkgPath)) return []
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return []
  }
  const external = pkg?.dsh?.client?.external
  if (!Array.isArray(external)) return []
  return [...new Set(external.filter((name) => typeof name === 'string' && name !== ''))]
}

/**
 * 从隔离 profile 的 package.json 里剔除指定包声明（issue #294，纯函数；原对象不被修改）。
 *
 * 为什么必须连配置一起剔除：只删 node_modules 条目会得到「配置里列着、但装不上」的
 * **不一致状态** —— DSH 在 dump-config / boot 阶段直接抛
 * `cannot resolve profile bundle "dsh-md-render" from the dsh installation or <profileDir>`
 * （本机实测，见 PR 证据），实例根本起不来，于是「缺包时插件能否降级」这个真正要验的
 * 场景反而验不到。剔除后才是新装用户的真实形态：包既不在 dependencies /
 * dsh.profile.bundles，也不在 node_modules（浏览器端 require 落空 → #290/#293 场景）。
 *
 * @param {object} pkg 隔离 profile 的 package.json 内容
 * @param {string[]} names 要剔除的包名
 * @returns {{pkg: object, removed: string[]}} 剔除后的新文档 + 被剔除的声明（供打印留痕）
 */
export function stripProfileDeclarations(pkg, names) {
  const copy = JSON.parse(JSON.stringify(pkg))
  const removed = []
  for (const name of names) {
    if (copy.dependencies && Object.prototype.hasOwnProperty.call(copy.dependencies, name)) {
      delete copy.dependencies[name]
      removed.push(`dependencies.${name}`)
    }
    const bundles = copy.dsh?.profile?.bundles
    if (!Array.isArray(bundles)) continue
    const at = bundles.indexOf(name)
    if (at >= 0) {
      bundles.splice(at, 1)
      removed.push(`dsh.profile.bundles.${name}`)
    }
  }
  return { pkg: copy, removed }
}

/** lstat 包装：区分「不存在」与「悬空软链」（existsSync 对悬空软链返回 false）。 */
function lstatOrNull(path) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

/** 删除模拟目录里的条目（软链只删链接本身，绝不跟随到真实 profile）。 */
function removeEntry(path) {
  const stat = lstatSync(path)
  if (stat.isDirectory()) rmSync(path, { recursive: true, force: true })
  else unlinkSync(path)
}

/**
 * 应用链接计划：真实条目全量软链 + addon 条目强制指向 addon 目录（issue #220）。
 *
 * addon 条目已存在（真实 profile 同名软链）时**重写**为指向 addon 的新软链，
 * 并把被替换的原目标记入 replaced（供脚本打印"原来指向哪"的证据）。
 *
 * issue #294：omit 里的条目**一个都不链接**（缺包演练），并在返回结果里列出
 * 实际被省略的条目（含 scope 展开时被跳过的子条目）——调用方据此打印 + fail-closed 校验。
 */
export function linkNodeModules({ simNode, realNode, addons, omit = [] }) {
  const plan = planNodeModulesLinks({ realEntries: readdirSync(realNode), addons, omit })
  const omitSet = new Set(omit)
  const addonEntries = new Set(plan.addonLinks.map((link) => link.entry))
  mkdirSync(simNode, { recursive: true })

  for (const entry of plan.reuse) symlinkSync(join(realNode, entry), join(simNode, entry))

  const omitted = [...plan.omitted]
  for (const scope of plan.expand) {
    mkdirSync(join(simNode, scope), { recursive: true })
    for (const child of readdirSync(join(realNode, scope))) {
      const entry = `${scope}/${child}`
      if (addonEntries.has(entry)) continue
      if (omitSet.has(entry)) {
        omitted.push(entry) // issue #294：scope 展开的子条目同样受 omit 约束
        continue
      }
      symlinkSync(join(realNode, scope, child), join(simNode, entry))
    }
  }

  const linked = []
  const replaced = []
  for (const { entry, dir } of plan.addonLinks) {
    const target = join(simNode, entry)
    const stat = lstatOrNull(target)
    if (stat !== null) {
      replaced.push({ entry, was: stat.isSymbolicLink() ? rawLink(target) : '(真实目录)' })
      removeEntry(target)
    }
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(dir, target)
    linked.push(entry)
  }
  // 被 addon 覆盖的真实 profile 条目原目标：脚本据此打印"原来指向主工作区"的证据
  const overridden = plan.overridden.map((entry) => ({ entry, was: rawLink(join(realNode, entry)) }))
  return { plan, linked, replaced, overridden, omitted, omittedAddons: plan.omittedAddons }
}

/**
 * 校验被 omit 的条目在模拟 profile 里**确实不可解析**（issue #294，fail-closed）。
 *
 * 假通过的第二层防线：即使 omit 接线写错（例如漏传、scope 展开路径写错），
 * 只要该条目仍能在 simNode 里解析到真实 profile 的软链，这里就报 leak ——
 * 脚本据此在实例启动前退出，绝不把「其实装了包」的实例当成「缺包演练」。
 */
export function checkOmittedAbsent({ simNode, omitted }) {
  const entries = omitted.map((entry) => {
    const link = join(simNode, entry)
    return { entry, link, exists: lstatOrNull(link) !== null, resolved: realpathOrNull(link) }
  })
  return { ok: entries.every((item) => !item.exists), entries, leaked: entries.filter((item) => item.exists) }
}

/** 读取软链的原始目标字符串（不解析），用于打印被替换条目"原来指向哪"。 */
function rawLink(path) {
  try {
    return readlinkSync(path)
  } catch {
    return '(未知)'
  }
}

// ── 解析路径校验（fail-closed） ────────────────────────────────────────────

/** realpath 包装：解析失败（不存在/悬空软链）返回 null 而不是抛错。 */
export function realpathOrNull(path) {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * 校验每个 addon 在模拟 profile 里的**实际解析路径**。
 *
 * 期望 = addon 目录的 realpath；实际 = 模拟条目 realpath。不等即 mismatch
 * （脚本据此告警并退出，不再静默继续——静默正是这个坑潜伏数轮的原因）。
 */
export function checkAddonResolution({ simNode, addons }) {
  const entries = addons.map((addon) => {
    const link = join(simNode, addon.name)
    const actual = realpathOrNull(link)
    const expected = realpathOrNull(addon.dir)
    return { name: addon.name, dir: addon.dir, link, actual, expected, ok: actual !== null && actual === expected }
  })
  return { ok: entries.every((entry) => entry.ok), entries, mismatches: entries.filter((entry) => !entry.ok) }
}

// ── 组合配置（dump-config）启用态判据（门禁 3c 盲区）────────────────────────

/**
 * 解析 `--dump-config` 输出为 entry 块列表（纯函数）。
 *
 * 块边界 = **顶层列表项**（行首 `- `，缩进 0）；`id:` / `name:` / `disabled:` 是 entry 的
 * **直接属性**（缩进 1–3 空格），而 `config:` 的子键缩进 ≥4 —— 只认直接属性，才谈得上
 * 「禁用位归属于被验证插件自己那一块」，不会与相邻 entry 或 config 内部字段串味。
 *
 * 为什么必须有它：旧判据只收集全文的 `name:` 行，于是
 *
 *     - id: my-context
 *       name: dsh-my-context
 *       disabled: true
 *
 * 这种块照样被算作「已出现在组合配置」——插件其实**被加载但处于禁用态**
 * （client bundle 不进 `window.__DSH_BOOT__.entries`、侧边栏页签不出现），门禁却判通过。
 * 生产 `~/.dsh/profiles/web/cordis.patch.yml` 里确实存在这种被 `disabled: true` 的插件行
 * （实测：guardian / task-reliability / ts-example / my-context / observability）。
 *
 * @param {string} dumpOutput `dsh --profile <p> --dump-config` 的 stdout
 * @returns {Array<{id: string|null, name: string|null, disabled: boolean}>}
 */
export function parseDumpEntries(dumpOutput) {
  const entries = []
  let current = null
  for (const line of String(dumpOutput ?? '').split('\n')) {
    if (/^- /.test(line)) {
      current = { id: null, name: null, disabled: false }
      entries.push(current)
    }
    if (current === null) continue
    // id 只在顶层项首行（`- id: x`）；name/disabled 是 1–3 空格缩进的直接属性。
    const idMatch = /^- id:\s*'?([A-Za-z0-9._-]+)'?\s*$/.exec(line)
    if (idMatch !== null && current.id === null) current.id = idMatch[1]
    const nameMatch = /^\s{1,3}name:\s*'?([A-Za-z0-9@._/-]+)'?\s*$/.exec(line)
    if (nameMatch !== null && current.name === null) current.name = nameMatch[1]
    if (/^\s{1,3}disabled:\s*true\s*$/.test(line)) current.disabled = true
  }
  return entries.filter((entry) => entry.id !== null || entry.name !== null)
}

/**
 * 发版门禁 3c 的核心判据（修复后口径）：被验证的 addon 必须在组合配置里**处于启用态**。
 *
 * 判据分三态，全部 fail-closed（任一不成立即 `ok: false` 并给出 `reason`）：
 *   1. 命中 entry 块且**没有**禁用位 → 通过；
 *   2. 命中 entry 块但该块 `disabled: true` → 判失败，原因点名「被禁用」——
 *      这正是被修复的盲区：插件被加载但不运行，功能级验证的前提根本不存在；
 *   3. 完全没有命中 → 判失败（原口径，bundles 声明可能未生效）。
 *
 * 范围严格限定在 `addons`（**本次要验证的那几个插件**）：dump 里其他插件被故意禁用
 * 不产生任何影响（不是「一票否决整份配置」），所以不误伤正当的禁用场景。
 *
 * @param {{dumpOutput: string, addons: Array<{name: string}>}} input
 * @returns {{ok: boolean, entries: Array<object>, missing: Array<object>, disabledAddons: Array<object>}}
 */
export function checkAddonEntriesEnabled({ dumpOutput, addons }) {
  const entries = parseDumpEntries(dumpOutput)
  const results = (addons ?? []).map((addon) => {
    const name = addon.name
    const matched = entries.filter((entry) => entry.name === name || entry.id === name)
    const enabled = matched.find((entry) => !entry.disabled) ?? null
    const disabled = matched.find((entry) => entry.disabled) ?? null
    let reason = null
    if (matched.length === 0) {
      reason = '未出现在组合配置中（bundles 声明可能未生效）'
    } else if (enabled === null) {
      reason =
        `在组合配置中被禁用（entry id=${disabled.id ?? '?'} 带 disabled: true）` +
        '—— 插件被加载但不会真正运行（client bundle 不进 manifest、页签不出现），功能级验证前提不成立'
    }
    return { name, matched, enabled, disabled, ok: reason === null, reason }
  })
  return {
    ok: results.every((item) => item.ok),
    entries: results,
    missing: results.filter((item) => item.matched.length === 0),
    disabledAddons: results.filter((item) => item.matched.length > 0 && !item.ok),
  }
}

// ── 组合配置里的重复 loader entry（发版门禁前置检查） ──────────────────────

/**
 * 组合配置里**真的重复挂载**的 loader entry id（纯函数，fail-closed 判据）。
 *
 * 口径 = 顶层 loader entry，与 `parseDumpEntries` / `checkAddonEntriesEnabled` **同源**
 * （同一个函数解析，不另造一套正则）—— 这是本检查唯一要拦的东西：同一份组合配置里
 * 两次挂载同一个 entry id，cordis loader 会在启动时报 duplicate loader entry。
 *
 * 为什么旧口径是错的：旧实现用 `/^\s*-?\s*id:/\` 匹配**任意缩进**的 `id:` 行，于是把
 * DSH 0.1.7-rc.2 起 dump 里展开的 **agent-preset 声明**内嵌清单也算成 loader entry ——
 *
 *     - id: tool-bash                       # 顶层 entry
 *       name: '@deepseek-ai/dsh-tool-bash'
 *     - id: preset-ptc                      # preset 声明
 *       name: '@deepseek-ai/dsh-agent-preset'
 *       config:
 *         id: ptc
 *         plugins:
 *           - id: persona                   # ← 缩进 6：preset 内嵌清单，不是 loader entry
 *           - id: tool-bash                 # ← 与顶层同名是**正常结构**，不是重复挂载
 *
 * 实测该假红在生产 profile 上给出 34 个「重复 id」（脚本口径 333 id / 34 重复），而
 * 顶格 loader entry 是 202 id / 0 重复（生产实例正常运行）—— 门禁在实例启动前
 * fail-closed，把三个插件的发版全部堵死。修正后**检查能力不变**：顶层真重复仍被拦下
 * （单测 scripts/test/verify-profile.test.mjs「② 顶层真出现重复 loader entry」）。
 *
 * @param {string} dumpOutput `dsh --profile <p> --dump-config` 的 stdout
 * @returns {string[]} 去重后的重复 id（按首次重复出现顺序）
 */
export function findDuplicateEntryIds(dumpOutput) {
  const seen = new Set()
  const duplicates = new Set()
  for (const entry of parseDumpEntries(dumpOutput)) {
    if (entry.id === null) continue
    if (seen.has(entry.id)) duplicates.add(entry.id)
    else seen.add(entry.id)
  }
  return [...duplicates]
}

/**
 * 在**隔离副本**的 `cordis.patch.yml` 文本里去掉某个 entry 的 `disabled: true`（纯函数）。
 *
 * 用途（verify-real-profile 的 `--enable-plugins`）：生产 profile 里确实存在被
 * `disabled: true` 的插件行（实测：guardian）——被禁用的插件「被加载但不运行」
 * （client bundle 不进 manifest、页签不出现），功能级验证前提不成立，3c 因此 fail-closed。
 * 手册 `skills/verifying-dsh-plugins/references/isolation-instance.md` 认可的做法是
 * **只在隔离副本内**去掉该禁用位、生产配置一字不动；本函数把这一步变成可测的纯函数。
 *
 * **判据没有放宽**：调用方随后仍要过「entry 必须在组合配置中处于启用态」
 * （checkAddonEntriesEnabled）——本函数只是让副本里它真的启用，而不是跳过检查。
 * 未命中目标行时原样返回 `enabled: false`（fail-closed，不静默放过）。
 *
 * @param {string} patchText 隔离副本里 cordis.patch.yml 的文本
 * @param {string} entryId dump-config 里的 entry id（如 `guardian`）
 * @returns {{text: string, enabled: boolean}} 新文本（不改输入）+ 是否真的去掉了禁用位
 */
export function enableEntryInPatch(patchText, entryId) {
  const text = String(patchText ?? '')
  const id = String(entryId ?? '')
  if (id === '') return { text, enabled: false }
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^- id: ${escaped}\n  disabled: true\n`, 'm')
  if (!pattern.test(text)) return { text, enabled: false }
  return { text: text.replace(pattern, `- id: ${id}\n`), enabled: true }
}

// ── 工作区落盘状态预置（隔离实例 GUI 前置） ────────────────────────────────

/** workspace 存储单元的头部（dsh-workspace 的 domain spec：name='workspace', version=2）。 */
export const WORKSPACE_UNIT = Object.freeze({ name: 'workspace', version: 2 })

/** ISO-8601 字符串判定（storages/workspace.json 的 createdAt/updatedAt 必须是字符串）。 */
export function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value === '') return false
  return !Number.isNaN(Date.parse(value))
}

/**
 * 构造 workspace 存储文档（纯函数）：`{ unit, global, tables }` 是三段式落盘格式，
 * records 形如 `{ path, title, sessionIds, createdAt, updatedAt }`（dsh-workspace spec）。
 *
 * path 必须是 realpath：DSH 用 fs.realpath 规范化工作区路径，macOS 上写 `/tmp/...`
 * 会在 attach 时报 session/workspace-attach-failed（`/tmp` 是 `/private/tmp` 的软链）。
 */
export function buildWorkspaceStorage({ workspacePath, title, workspaceId, now }) {
  const timestamp = now ?? new Date().toISOString()
  return {
    unit: { ...WORKSPACE_UNIT },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [] },
    tables: {
      workspaces: {
        [workspaceId]: {
          path: workspacePath,
          title,
          sessionIds: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    },
  }
}

/** 校验 workspace 存储文档是否符合 DSH 的隐性 Zod 约束，返回错误信息列表（空数组 = 通过）。 */
export function validateWorkspaceStorage(document) {
  const errors = []
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return ['存储文档不是 JSON 对象']
  const { unit, global: globalState, tables } = document
  if (typeof unit !== 'object' || unit === null) errors.push('缺少 unit 头部')
  else {
    if (unit.name !== WORKSPACE_UNIT.name)
      errors.push(`unit.name 必须是 '${WORKSPACE_UNIT.name}'（实际 ${JSON.stringify(unit.name)}）`)
    if (unit.version !== WORKSPACE_UNIT.version) {
      errors.push(`unit.version 必须是 ${WORKSPACE_UNIT.version}（实际 ${JSON.stringify(unit.version)}）`)
    }
  }
  if (typeof globalState !== 'object' || globalState === null) errors.push('缺少 global 段')
  else {
    if (globalState.initialized !== true)
      errors.push('global.initialized 必须是 true（否则实例会走"未初始化"引导流程）')
    if (!Array.isArray(globalState.workspaceIds)) errors.push('global.workspaceIds 必须是数组')
  }
  const records = tables?.workspaces
  if (typeof records !== 'object' || records === null || Array.isArray(records)) {
    errors.push('tables.workspaces 必须是对象')
    return errors
  }
  for (const [id, record] of Object.entries(records)) {
    if (typeof record !== 'object' || record === null) {
      errors.push(`tables.workspaces.${id} 不是对象`)
      continue
    }
    if (typeof record.path !== 'string' || record.path === '')
      errors.push(`tables.workspaces.${id}.path 必须是非空字符串`)
    if (typeof record.title !== 'string') errors.push(`tables.workspaces.${id}.title 必须是字符串`)
    if (!Array.isArray(record.sessionIds)) errors.push(`tables.workspaces.${id}.sessionIds 必须是数组`)
    for (const field of ['createdAt', 'updatedAt']) {
      if (!isIsoTimestamp(record[field])) {
        errors.push(`tables.workspaces.${id}.${field} 必须是 ISO-8601 字符串（实际 ${JSON.stringify(record[field])}）`)
      }
    }
  }
  return errors
}

/**
 * 预置隔离 DSH_HOME 的工作区状态：写 `<simHome>/storages/workspace.json`，并对
 * path 取 realpath、写入后回读校验（任一不符即抛错 → 脚本 fail-closed 退出）。
 *
 * @returns {{file: string, workspaceId: string, path: string}}
 */
export function writeWorkspaceStorage({ simHome, workspacePath, title, workspaceId, now }) {
  const canonical = realpathOrNull(resolve(workspacePath))
  if (canonical === null) throw new Error(`--workspace 目录不存在: ${resolve(workspacePath)}`)
  const id = workspaceId ?? randomUUID()
  const document = buildWorkspaceStorage({
    workspacePath: canonical,
    title: title ?? basename(canonical),
    workspaceId: id,
    now,
  })
  const errors = validateWorkspaceStorage(document)
  if (errors.length > 0) throw new Error(`workspace 存储文档不符合 DSH 约束: ${errors.join('; ')}`)
  const file = join(simHome, 'storages', 'workspace.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  const backErrors = validateWorkspaceStorage(JSON.parse(readFileSync(file, 'utf8')))
  if (backErrors.length > 0) throw new Error(`workspace 存储回读校验失败: ${backErrors.join('; ')}`)
  return { file, workspaceId: id, path: canonical }
}

/**
 * 插件自维护的「启停状态」目录（issue #240）。
 *
 * 症状：隔离实例**静默少加载几个插件**——client bundle 不进 manifest、server API 404，
 * 看上去就像"这个插件坏了"，于是 agent 掉头去查插件本身（两个 agent 都在这里烧过时间）。
 *
 * 根因：dshmarket 插件把自己维护的启停开关写在
 * `<DSH_HOME>/profiles/<profile>/.dsh-market/state.json`（形如 `{"disabled":[...]}`），
 * 启动时按它**强制 off** 名单里的插件（日志：`.dsh-market/log.ndjson` → `my-context -> off: fiber=false`）。
 * verify-real-profile.mjs 复刻生产 profile 时把它一起 `cpSync` 过去，隔离实例于是"继承"了
 * 生产环境的禁用名单 —— 生产里被手动关掉的插件，在验证环境里永远起不来。
 *
 * 判定与修法：复刻时**剥离**这些状态目录，并且**必须打印**（静默正是这个坑潜伏数轮的原因）。
 */
export const PLUGIN_STATE_DIRS = Object.freeze(['.dsh-market'])

/** 该路径是否落在插件自维护的状态目录内（供 cpSync 的 filter 使用）。 */
export function isPluginStatePath(src) {
  const text = String(src ?? '')
  return PLUGIN_STATE_DIRS.some((dir) => text.includes(`/${dir}/`) || text.endsWith(`/${dir}`))
}

/** 真实 profile 里实际存在哪些状态目录（用于打印"已剥离"提示，避免静默）。 */
export function presentStateDirs(realProfile) {
  return PLUGIN_STATE_DIRS.filter((dir) => existsSync(join(realProfile, dir)))
}

/**
 * 从「实例输出」或「凭据文件」里解析访问 token（issue #257）。
 *
 * 为什么需要：DSH web 对无凭据请求返回 401/403，而 `--api-path` 冒烟过去是裸 fetch，
 * 于是恒失败且报错归因指向"插件路由异常"，把排查引向错误方向。
 *
 * ⚠️ 两个实测结论（别重蹈）：
 *   1. `.credentials.yaml` 里的 `secret` **不是** URL 里的 token（长度同为 43 但内容不同），
 *      拿它冒充 token 只会被拒 —— 所以这里**只认显式的 token 字段**，不做模糊匹配；
 *   2. 在本机环境里，`dsh web` 由脚本 spawn 起来时**两种捕获方式都没有打印 token 行**
 *      （pipe 与文件重定向都试过）—— 因此本函数经常返回 null，调用方**必须显式失败**
 *      而不是静默跳过（见 issue #257 的待确认项）。
 */
export function extractApiToken({ logText = '', credentialsText = '' } = {}) {
  const fromLog = /token=([A-Za-z0-9_-]{10,})/.exec(String(logText))
  if (fromLog) return { token: fromLog[1], source: '启动输出' }
  const fromCredentials = /^\s*token:\s*([A-Za-z0-9_-]{10,})/m.exec(String(credentialsText))
  if (fromCredentials) return { token: fromCredentials[1], source: '.credentials.yaml' }
  return { token: null, source: null }
}

// ── 启动结果判定（issue #305：崩溃必须 fail-closed）─────────────────────────
/**
 * 启动失败的「定论」特征。命中任意一条即判定实例**启动失败**（不是"还没起好"）。
 *
 * 为什么单独拉出来：`dsh web` 会**先监听端口**、再加载插件树。插件 apply 崩掉时，
 * 端口已经能回 HTTP（脚本旧实现据此判"就绪"），随后进程才带栈退出 —— 于是崩溃被
 * 当成通过（issue #305 实测：#298 的 `inject` 缺 `webServer` 就是这样潜伏的）。
 *
 * 关键词表按实测补全（第四项 `cannot get property` 由 #298 的原始崩溃日志驱动）：
 *  - `plugin tree failed to load`：dsh-app-boot 的顶层失败摘要；
 *  - `failed to apply loader entry` / `failed to import loader entry`：cordis 加载器；
 *  - `without inject` / `cannot get property`：cordis service 守卫（#298 形态）；
 *  - `missed the module table`：依赖缺包（#294 场景）；
 *  - `duplicate loader entry`：配置组合炸弹。
 */
export const FATAL_BOOT_PATTERNS = Object.freeze([
  /plugin tree failed to load/i,
  /failed to (?:apply|import) loader entry/i,
  /without inject/i,
  /cannot get property/i,
  /missed the module table/i,
  /duplicate loader entry/i,
])

/**
 * 启动成功的**正向**证据：`dsh web` 就绪后会打印
 * `dsh web: http://127.0.0.1:<port>/?token=<43 字符>`（实测，见 #257/#305）。
 * 只认它，不认"端口回了个 HTTP" —— 后者在崩溃场景同样成立。
 */
export const BOOT_READY_PATTERN = /dsh web: https?:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]{10,}/

/** 扫描文本，返回命中的致命启动特征（去重、保序）。 */
export function fatalBootHits({ logText = '' } = {}) {
  const text = String(logText ?? '')
  const hits = []
  for (const pattern of FATAL_BOOT_PATTERNS) {
    const m = pattern.exec(text)
    if (m) hits.push(m[0])
  }
  return hits
}

/** 文本里是否出现"实例已就绪"的正向证据（token 行）。 */
export function hasBootReadyLine({ logText = '' } = {}) {
  return BOOT_READY_PATTERN.test(String(logText ?? ''))
}

/**
 * 判定一次启动尝试的结果（纯函数，供单测与集成路径共用）。
 *
 * 语义（fail-closed）：
 *  - 日志命中致命特征 → `failed`（**优先于**就绪行：先崩后残留的就绪行不算数）；
 *  - 有就绪行且进程仍存活 → `ready`；
 *  - 有就绪行但进程已退出 → `failed`（起来了又崩，同样不可用）；
 *  - 都没有 → `pending`（调用方继续轮询，超时后再判失败）。
 *
 * @param {{logText?: string, exited?: boolean}} input
 * @returns {{verdict: 'failed'|'ready'|'pending', hits: string[], reason: string|null}}
 */
export function decideBootOutcome({ logText = '', exited = false } = {}) {
  const hits = fatalBootHits({ logText })
  if (hits.length > 0) {
    return { verdict: 'failed', hits, reason: `启动日志出现致命特征：${hits.join(' / ')}` }
  }
  const ready = hasBootReadyLine({ logText })
  if (ready && exited) {
    return { verdict: 'failed', hits: [], reason: '实例打印了就绪行但进程随后退出（启动中途崩溃）' }
  }
  if (ready) return { verdict: 'ready', hits: [], reason: null }
  if (exited) {
    return { verdict: 'failed', hits: [], reason: '实例进程已退出且日志未出现就绪行（启动即崩）' }
  }
  return { verdict: 'pending', hits: [], reason: null }
}

/** 从启动日志里摘出可诊断的崩溃摘要（供失败时打印关键行 + 日志路径）。 */
export function bootFailureExcerpt({ logText = '', maxLines = 6 } = {}) {
  const lines = String(logText ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return '(实例日志为空：进程在写出任何输出前就退出了)'
  const start = lines.findIndex((line) => /Error|error|failed|without inject/.test(line))
  const from = start === -1 ? 0 : start
  return lines.slice(from, from + maxLines).join('\n')
}
