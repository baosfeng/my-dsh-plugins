/**
 * changelog-merge.mjs — `--bump` 生成新版本段时，把既有的 `## [Unreleased]` 段消费掉。
 *
 * ## 事故（真实，dsh-my-memory 0.3.0）
 *
 * release.mjs 原先只找文件第一个 `## [`，把新段落插到它前面，**从不消费 Unreleased**。
 * 发 0.3.0 后 CHANGELOG 变成：
 *
 *     ## [0.3.0]（3 条 git log 摘要）→ ## [Unreleased]（几十条手写细节，写的正是 0.3.0）→ ## [0.2.0] …
 *
 * 手写细节被落在文件中间，读者看不到 0.3.0 到底改了什么（版本段只有自动摘要）。
 *
 * ## 判据（本文件即唯一权威）
 *
 * 1. **只消费第一个** `## [Unreleased]` 段（= 最靠近文件顶、约定里待发的那一段）。
 *    其它遗留的 Unreleased 段原样保留并计入 `staleUnreleased`——归属不可推断时，
 *    宁可留着让人看，也不把手写历史误并进新版本。
 * 2. **手写细节优先**：被消费那段的正文（含 `### 小节` 结构）整段搬进新版本段，逐字不改写。
 * 3. **git log 摘要只在未被手写条目覆盖时保留**：覆盖判据 = 去掉 `<hash>`、conventional
 *    前缀与 `(#123)` 引用后，摘要的**字符二元组**有 ≥ `COVER_RATIO` 出现在某一条手写
 *    条目里（中文没有空格，二元组是最稳的相似度单位；实测 dsh-my-memory 0.3.0 三条摘要
 *    相似度为 0.70 / 1.00 / 0.14，阈值 0.5 落在正反例中间）。只丢摘要、不丢手写：
 *    判错的代价上限是「少一条自动摘要」，且丢了几条会被 release.mjs 打印出来。
 * 4. **无 Unreleased 段 / 段内为空 → 与旧实现逐字节一致**（回归不退化：仍输出
 *    `## [ver] - date` + `### 变更` + git log 条目），见 scripts/test/changelog-merge.test.mjs。
 * 5. **行区间拼接，不重排未改动的段**：只动「新段」与「被消费的 Unreleased 段」两处行，
 *    其余段落原样保留（避免整份 CHANGELOG 被重新格式化 / 空行归一带来的无意义 diff）。
 */

/** 二级标题（段边界）。 */
const H2 = /^##\s/
/** `## [0.3.0] - 2026-11-01` / `## [Unreleased]` 形态的二级标题。 */
const H2_BRACKET = /^##\s+\[([^\]]+)\]/
/** 列表条目（含缩进子条目）。 */
const BULLET = /^\s*[-*]\s+/
/** 覆盖阈值：摘要的二元组有多少落在某条手写条目里即视为已覆盖。 */
const COVER_RATIO = 0.5

/** 去掉行尾 / 行首空行（返回新数组，不改入参）。 */
function trimBlank(lines) {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start++
  while (end > start && lines[end - 1].trim() === '') end--
  return lines.slice(start, end)
}

/** 扫段：返回每个 `## ` 段的标题名（`[x]` 里的 x，非括号标题为 null）、起止行号。 */
function scanSections(lines) {
  const sections = []
  for (let i = 0; i < lines.length; i++) {
    if (!H2.test(lines[i])) continue
    const m = H2_BRACKET.exec(lines[i])
    sections.push({ name: m ? m[1].trim() : null, start: i })
  }
  for (let k = 0; k < sections.length; k++) {
    sections[k].end = k + 1 < sections.length ? sections[k + 1].start : lines.length
  }
  return sections
}

/**
 * 摘要主体：去掉短 hash、conventional 前缀（`fix(scope)!:`）与 PR 引用（`(#123)`）。
 * 传 `git log --oneline` 原行或 CHANGELOG 条目行都可以。
 */
export function gitSummaryCore(line) {
  return String(line ?? '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^[0-9a-f]{7,40}\s+/i, '')
    .replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, '')
    .replace(/\(#\d+\)/g, ' ')
    .replace(/#\d+/g, ' ')
    .trim()
}

/** 归一化：小写、去掉空白与标点，只留可比较的正文。 */
function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[\s*_`>|~]/g, '')
    .replace(/[（）()「」『』【】\[\]，。、：:；;！!？?,\-—–\/\\→]/g, '')
}

/** 字符二元组集合（中文无空格，二元组是最稳的相似度单位）。 */
function bigrams(text) {
  const n = normalize(text)
  const set = new Set()
  for (let i = 0; i + 2 <= n.length; i++) set.add(n.slice(i, i + 2))
  return set
}

/**
 * 这条 git 摘要是否已被某条手写条目覆盖（覆盖 = 不再重复写进新版本段）。
 *
 * @param {string} summaryLine `git log --oneline` 行或 CHANGELOG 条目
 * @param {string[]} handwrittenLines 手写条目正文（不含 `- ` 前缀也可以）
 */
export function isCoveredByHandwritten(summaryLine, handwrittenLines) {
  const core = gitSummaryCore(summaryLine)
  const c = normalize(core)
  // 太短的摘要（如「修复」两个字）没有可用信号，一律不判重——宁可重复一条也不误删
  if (c.length < 3) return false
  const mine = bigrams(core)
  if (mine.size === 0) return false
  for (const line of handwrittenLines) {
    const hn = normalize(line)
    if (hn === '') continue
    if (hn.includes(c)) return true
    const theirs = bigrams(line)
    let hit = 0
    for (const gram of mine) if (theirs.has(gram)) hit++
    if (hit / mine.size >= COVER_RATIO) return true
  }
  return false
}

/** 最后一个小节标题（`### `）的下标；没有返回 -1。 */
function lastSubheadingIndex(lines) {
  for (let i = lines.length - 1; i >= 0; i--) if (/^###\s/.test(lines[i])) return i
  return -1
}

/**
 * 生成新版本段，并把第一个 `## [Unreleased]` 段并入后删除。
 *
 * @param {string} changelog CHANGELOG.md 全文
 * @param {object} options
 * @param {string} options.version 新版本号（如 `0.3.1`）
 * @param {string} [options.date] 发布日期（`YYYY-MM-DD`）；省略则标题不带日期
 * @param {string[]} [options.logLines] `git log --oneline` 行（带 hash 亦可）
 * @returns {{ text: string, stats: { consumedUnreleased: boolean, handwrittenBullets: number,
 *   droppedGitBullets: number, keptGitBullets: number, staleUnreleased: number } }}
 */
export function mergeUnreleasedIntoVersion(changelog, { version, date, logLines = [] } = {}) {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new TypeError('mergeUnreleasedIntoVersion: version 必填')
  }
  const source = String(changelog ?? '')
  const heading = date ? `## [${version}] - ${date}` : `## [${version}]`

  const lines = source.split('\n')
  const unreleasedSections = scanSections(lines).filter((s) => s.name !== null && s.name.toLowerCase() === 'unreleased')
  const consumed = unreleasedSections[0] ?? null
  const body = consumed ? trimBlank(lines.slice(consumed.start + 1, consumed.end)) : []
  const handwritten = body
    .filter((l) => BULLET.test(l))
    .map((l) => l.replace(BULLET, '').trim())
    .filter(Boolean)

  // git 摘要：已被手写条目覆盖的不重复
  const kept = []
  let dropped = 0
  for (const line of logLines) {
    if (handwritten.length > 0 && isCoveredByHandwritten(line, handwritten)) dropped++
    else kept.push(String(line))
  }
  // 与旧实现同形：去掉行首第一个词（git log --oneline 的短 hash）
  const bullets = kept.map((l) => `- ${l.trim().replace(/^\w+\s+/, '')}`).filter((b) => b !== '- ')

  const sectionLines = []
  sectionLines.push(heading, '')
  if (body.length === 0) {
    sectionLines.push('### 变更', '', ...bullets)
  } else {
    const merged = body.slice()
    if (bullets.length > 0) {
      while (merged.length > 0 && merged[merged.length - 1].trim() === '') merged.pop()
      const lastSub = lastSubheadingIndex(merged)
      if (lastSub >= 0 && /^###\s+变更\s*$/.test(merged[lastSub])) {
        // 已有「变更」小节：接着写，不另起一个同名小节
        merged.push(...bullets)
      } else {
        merged.push('', '### 变更', '', ...bullets)
      }
    }
    sectionLines.push(...trimBlank(merged))
  }

  // 行区间拼接：先摘掉被消费的 Unreleased 段（保留「上一段 + 一个空行 + 下一段」）
  let base = lines.slice()
  if (consumed) {
    const before = trimBlank(base.slice(0, consumed.start))
    const after = base.slice(consumed.end)
    base = before.length === 0 ? after : after.length === 0 ? [...before, ''] : [...before, '', ...after]
  }

  let insertAt = base.findIndex((l) => H2_BRACKET.test(l))
  if (insertAt === -1) insertAt = base.findIndex((l) => H2.test(l))
  let text
  if (insertAt === -1) {
    // 没有任何二级标题：追加在文件末尾（去掉尾部空行再补一个换行）
    const tail = trimBlank(base)
    text = [...(tail.length > 0 ? [...tail, ''] : []), ...sectionLines, ''].join('\n')
  } else {
    text = [...base.slice(0, insertAt), ...sectionLines, '', ...base.slice(insertAt)].join('\n')
  }

  return {
    text,
    stats: {
      consumedUnreleased: consumed !== null,
      handwrittenBullets: handwritten.length,
      droppedGitBullets: dropped,
      keptGitBullets: bullets.length,
      staleUnreleased: Math.max(unreleasedSections.length - 1, 0),
    },
  }
}

export const CHANGELOG_COVER_RATIO = COVER_RATIO
