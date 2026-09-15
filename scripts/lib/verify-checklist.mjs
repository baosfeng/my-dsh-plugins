/**
 * verify-checklist.mjs — 发版前功能级验证清单的渲染 / 幂等合并 / 校验
 * （issue #67 留痕门禁 + issue #329 幂等修复）。
 *
 * 背景（#329 事故，反模式「生成器重写人工编辑的文件」）：
 * `node scripts/verify-real-profile.mjs --checklist verification/<插件>-<版本>.md` 过去
 * **整文件重写**目标清单 —— 已发布版本的清单在发布后被重跑一次，结果：
 *
 *   - 末尾「验证记录（真实环境证据）」整段（实测 45 行：缺包演练命令、隔离实例证据、
 *     真实模型会话结论）被删除；
 *   - 头部「验证时间 / 端口」被改写（3092 → 3087）——对已发布版本是无意义假 diff；
 *   - 改动以**未提交状态**留在工作区，混在其他改动里极易被顺手提交掉。
 *
 * 即：重跑（复验、换端口复现）本是正常操作，却被这个副作用惩罚；而丢掉的是
 * issue #67 发版门禁的留痕证据。
 *
 * 本模块因此把「清单是**脚本与人工共同拥有**的文档」显式建模，并作为该流程的
 * 唯一实现（脚本只做接线，逻辑可单测 —— 不需要启动任何隔离实例）：
 *
 *   - 脚本拥有：`## 自动验证项` 段（本轮自动断言的结果）；
 *   - 人工拥有：头部时间/环境行的历史值、`## 功能级验证项` 的勾选结论，以及
 *     `## 功能级验证项` 之后的**一切**（`## 验证记录` 等手写证据段落）。
 *
 * 已存在文件时的合并规则（issue #329 验收判据）：
 *   1. 头部（标题 / 验证时间 / 验证环境）**逐字节保留**：时间戳每次运行必然不同，
 *      任何"刷新"都必然产生假 diff（不同端口重跑尤其明显）。确需把本轮环境写入留痕时
 *      用 `refreshHeader: true`（CLI 的 `--refresh-header`）显式开启。
 *   2. `## 自动验证项` 段：本轮结果权威 —— 既有自动项刷新为 `[x]`，本轮新增项补入；
 *      上一轮有、本轮没有的列表行**保留不删**（宁多留证据，不删证据）。
 *   3. `## 功能级验证项` 段：勾选状态是**人工结论**，逐字节保留；只补入模板新增项。
 *   4. `## 功能级验证项` 之后的一切：**逐字节原样**（人工段落永不被改写）。
 *   5. 结构不可识别（缺 `## 自动验证项` / `## 功能级验证项` 锚点）时**返回原文**
 *      （fail-closed：宁可不更新，也不丢人工记录）。
 */
import { existsSync, readFileSync } from 'node:fs'

/** 自动验证项段标题（锚点，issue #67 清单格式的一部分）。 */
const AUTO_HEAD = '## 自动验证项'
/** 功能级验证项段标题（锚点；`--check` 门禁按它切段）。 */
const FUNCTIONAL_HEAD = '## 功能级验证项'
/** 清单条目行：`- [ ] 文案` 或 `- [x] 文案`。 */
const ITEM_RE = /^- \[( |x)\] (.+)$/
/** 头部中"脚本可管理"的行前缀（仅在 refreshHeader 时刷新）。 */
const HEADER_KEYS = Object.freeze([
  ['验证时间：', 'time'],
  ['验证环境：', 'env'],
])

/** 脚本自动断言的验证项（issue #67 的 4 条；缺包演练行由调用方追加）。 */
export const DEFAULT_AUTO_ITEMS = Object.freeze([
  '配置组合唯一性（dump-config 无重复插件行 id）',
  '实例启动就绪（HTTP 200）',
  '启动日志无 error / duplicate 记录',
  '插件 API 冒烟（--api-path 全部 200）',
])

/** 需验证者在隔离实例 + 真实浏览器中逐项确认的功能级验证项（issue #67 的 5 条）。 */
export const FUNCTIONAL_ITEMS = Object.freeze([
  '核心功能走通（插件主功能在真实 GUI 中可用）',
  '易碎场景（重启恢复 / 会话隔离 / 持久化）',
  'client UI 正常（侧边栏页签 / 设置页 / 交互）',
  '插件间联动不崩（与相邻插件共存）',
  '验证后环境已清理（实例停止 / 临时目录删除 / 端口释放）',
])

/**
 * 渲染一份全新清单（目标文件不存在时的内容）。
 * 与 issue #67 引入 `--checklist` 时的模板逐字节一致（行为零回归）。
 */
export function renderChecklist({ plugin, version, port, timestamp, autoItems = DEFAULT_AUTO_ITEMS }) {
  const autoLines = autoItems.map((text) => `- [x] ${text}`).join('\n')
  const funcLines = FUNCTIONAL_ITEMS.map((text) => `- [ ] ${text}`).join('\n')
  return `# 发版前功能级验证清单 — ${plugin}@${version}

验证时间：${timestamp}
验证环境：隔离实例（端口 ${port}，复用生产 profile 配置组合，独立 DSH_HOME）

${AUTO_HEAD}（verify-real-profile.mjs 自动执行）

${autoLines}

${FUNCTIONAL_HEAD}（需在隔离实例 + 真实浏览器中验证后勾选）

${funcLines}

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。
`
}

/**
 * 把清单切成四块，供幂等合并按块决定"谁拥有"。
 *
 * @param {string} text 清单全文
 * @returns {{ok: boolean, lines: string[], header: string[], auto: string[], functional: string[], tail: string[]}}
 *   `tail` = `## 功能级验证项` 段之后的一切（含 `## 验证记录` 人工段落），永不被脚本改写。
 */
export function parseChecklist(text) {
  const lines = String(text ?? '').split('\n')
  const autoIdx = lines.findIndex((line) => line.startsWith(AUTO_HEAD))
  const funcIdx = lines.findIndex((line) => line.startsWith(FUNCTIONAL_HEAD))
  if (autoIdx === -1 || funcIdx === -1 || funcIdx < autoIdx) {
    return { ok: false, lines, header: [], auto: [], functional: [], tail: [] }
  }
  let tailIdx = -1
  for (let i = funcIdx + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      tailIdx = i
      break
    }
  }
  return {
    ok: true,
    lines,
    header: lines.slice(0, autoIdx),
    auto: lines.slice(autoIdx, funcIdx),
    functional: lines.slice(funcIdx, tailIdx === -1 ? lines.length : tailIdx),
    tail: tailIdx === -1 ? [] : lines.slice(tailIdx),
  }
}

/**
 * 幂等合并：以既有清单为骨架，只刷新脚本拥有的部分。
 *
 * @param {{existingText: string, freshText: string, refreshHeader?: boolean}} input
 * @returns {{text: string, merged: boolean, reason: string|null}}
 */
export function mergeChecklist({ existingText, freshText, refreshHeader = false }) {
  const existing = parseChecklist(existingText)
  if (!existing.ok) {
    return {
      text: existingText,
      merged: false,
      reason: '既有清单结构不可识别（缺自动/功能级段锚点）—— 已原样保留、未做任何改写',
    }
  }
  const fresh = parseChecklist(freshText)
  const text = [
    // 头部（标题/验证时间/验证环境）：默认逐字节保留，避免对已发布版本产生假 diff。
    ...(refreshHeader ? refreshHeaderLines(existing.header, fresh.header) : existing.header),
    ...refreshSection(existing.auto, collectItems(fresh.auto), { forceChecked: true }),
    ...refreshSection(existing.functional, collectItems(fresh.functional), { forceChecked: false }),
    // 人工段落：逐字节原样。
    ...existing.tail,
  ].join('\n')
  return { text, merged: true, reason: null }
}

/** 校验清单文本：功能级验证项必须全部 [x]（release.mjs 的 #67 门禁判据）。 */
export function checkChecklistText(text) {
  const doc = parseChecklist(text)
  const pending = []
  if (doc.ok) {
    for (const line of doc.functional) {
      const m = ITEM_RE.exec(line.trim())
      if (m !== null && m[1] !== 'x') pending.push(m[2])
    }
  }
  return { ok: pending.length === 0, pending }
}

/**
 * 读文件并校验（供 `--check` 使用）；文件不存在时 `missing: true`。
 * 与旧实现一致：**无功能级段**的清单不阻断发版（历史清单兼容）。
 */
export function checkChecklistFile(path) {
  if (!existsSync(path)) return { ok: false, missing: true, pending: [] }
  return { ...checkChecklistText(readFileSync(path, 'utf8')), missing: false }
}

/** 收集段内的列表项（保留原文，便于逐字节比对）。 */
function collectItems(lines) {
  const items = []
  for (const line of lines ?? []) {
    const m = ITEM_RE.exec(line.trim())
    if (m !== null) items.push({ text: m[2], checked: m[1] === 'x' })
  }
  return items
}

/**
 * 刷新一个段：保留原段每一行，只做两件最小改动 ——
 *   ① 脚本站得住脚的项（自动项段）把 `[ ]` 刷成 `[x]`；
 *   ② 补入本轮新增、原段没有的项（插在该段最后一个列表行之后）。
 * 原段里脚本不认识的列表行（人工新增项、上一轮的额外自动项）**保留不删**。
 */
function refreshSection(oldLines, freshItems, { forceChecked }) {
  const present = new Set()
  const out = []
  let insertAt = -1
  for (const line of oldLines) {
    const m = ITEM_RE.exec(line.trim())
    if (m === null) {
      out.push(line)
      continue
    }
    present.add(m[2])
    out.push(forceChecked && m[1] !== 'x' ? line.replace('- [ ]', '- [x]') : line)
    insertAt = out.length
  }
  const missing = freshItems.filter((item) => !present.has(item.text))
  if (missing.length === 0) return out
  const added = missing.map((item) => `- [${forceChecked || item.checked ? 'x' : ' '}] ${item.text}`)
  if (insertAt === -1) out.splice(1, 0, ...added)
  else out.splice(insertAt, 0, ...added)
  return out
}

/** 仅刷新头部里脚本可管理的行（验证时间 / 验证环境），其余行原样。 */
function refreshHeaderLines(oldHeader, freshHeader) {
  const freshByKey = new Map()
  for (const line of freshHeader ?? []) {
    const key = headerKey(line)
    if (key !== null) freshByKey.set(key, line)
  }
  return oldHeader.map((line) => {
    const key = headerKey(line)
    if (key !== null && freshByKey.has(key)) return freshByKey.get(key)
    return line
  })
}

/** 头部行的管理键（非管理行返回 null）。 */
function headerKey(line) {
  for (const [prefix, key] of HEADER_KEYS) {
    if (line.startsWith(prefix)) return key
  }
  return null
}
