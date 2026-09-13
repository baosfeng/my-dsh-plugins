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
 *   2. linkNodeModules —— 应用计划（真实 fs；重写软链，不污染真实 profile）；
 *   3. checkAddonResolution —— realpath 解析校验（fail-closed：脚本在实例启动前
 *      打印并断言）。比较一律用 realpath：macOS 上 /tmp 是 /private/tmp 的软链，
 *      直接比字符串会把正确链接误判成错误、把错误链接误判成正确；
 *   4. buildWorkspaceStorage / validateWorkspaceStorage / writeWorkspaceStorage
 *      —— 预置隔离实例的工作区落盘状态。storages/workspace.json 有**隐性 Zod
 *      校验**（unit 头 + ISO 时间戳 + path 必须是 realpath），格式错误会让实例
 *      启动即失败，故写入后回读校验（fail-closed）。
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
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
 * @param {{realEntries: string[], addons: Array<{dir: string, name: string}>}} input
 * @returns {{reuse: string[], expand: string[], addonLinks: Array<{entry: string, dir: string}>, overridden: string[]}}
 */
export function planNodeModulesLinks({ realEntries, addons }) {
  const addonLinks = addons.map((addon) => ({ entry: addon.name, dir: addon.dir }))
  const addonEntries = new Set(addonLinks.map((link) => link.entry))
  const scopes = new Set()
  for (const entry of addonEntries) {
    if (entry.startsWith('@') && entry.includes('/')) scopes.add(entry.split('/')[0])
  }
  const reuse = []
  const expand = []
  for (const entry of realEntries) {
    if (addonEntries.has(entry)) continue // addon 显式指定 → 不复用真实 profile 条目
    if (scopes.has(entry)) {
      expand.push(entry) // scope 目录整体软链会让 addon 写入污染真实 profile → 展开
      continue
    }
    reuse.push(entry)
  }
  return { reuse, expand, addonLinks, overridden: realEntries.filter((entry) => addonEntries.has(entry)) }
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
 */
export function linkNodeModules({ simNode, realNode, addons }) {
  const plan = planNodeModulesLinks({ realEntries: readdirSync(realNode), addons })
  const addonEntries = new Set(plan.addonLinks.map((link) => link.entry))
  mkdirSync(simNode, { recursive: true })

  for (const entry of plan.reuse) symlinkSync(join(realNode, entry), join(simNode, entry))

  for (const scope of plan.expand) {
    mkdirSync(join(simNode, scope), { recursive: true })
    for (const child of readdirSync(join(realNode, scope))) {
      const entry = `${scope}/${child}`
      if (addonEntries.has(entry)) continue
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
  return { plan, linked, replaced, overridden }
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
