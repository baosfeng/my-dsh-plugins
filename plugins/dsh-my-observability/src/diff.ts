/**
 * dsh-my-observability — unified diff parser (pure functions).
 *
 * 解析 `git diff` 输出的 unified diff 文本，提取每个变更文件的新增/删除
 * 行（含行号）与二进制标记，供规则审查引擎消费。全部为纯函数，可独立
 * 测试。
 */

/** 新增行（行号 + 文本，行号来自 hunk 头）。 */
export interface DiffAddedLine {
  line: number
  text: string
}

/** 单个变更文件。 */
export interface DiffFile {
  path: string
  insertions: number
  deletions: number
  addedLines: DiffAddedLine[]
  binary: boolean
}

/** 解析结果。 */
export interface ParsedDiff {
  files: DiffFile[]
  binary: boolean
}

/** diff 行分类。 */
type LineKind = 'file' | 'binary' | 'hunk' | 'added' | 'deleted' | 'context' | 'other'

/** 应用一行的结果（新的 hunkLine + 二进制标记）。 */
interface AppliedLine {
  hunkLine: number
  binary?: boolean
}

/** 解析 diff 文本：{ files, binary }。 */
export function parseDiff(text: unknown): ParsedDiff {
  if (typeof text !== 'string' || text === '') return { files: [], binary: false }
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  let hunkLine = 0
  let binary = false
  for (const line of text.split('\n')) {
    const kind = classifyLine(line)
    if (kind === 'file') {
      current = { path: pathOf(line), insertions: 0, deletions: 0, addedLines: [], binary: false }
      files.push(current)
      hunkLine = 0
      continue
    }
    if (current === null) continue
    const applied = applyLine(current, kind, line, hunkLine)
    hunkLine = applied.hunkLine
    if (applied.binary) binary = true
  }
  return { files, binary }
}

/** 应用一行到当前文件（返回新的 hunkLine 与 binary 标记）。 */
function applyLine(current: DiffFile, kind: LineKind, line: string, hunkLine: number): AppliedLine {
  if (kind === 'binary') {
    current.binary = true
    return { hunkLine, binary: true }
  }
  if (kind === 'hunk') return { hunkLine: hunkLineOf(line) }
  if (kind === 'added') {
    current.insertions += 1
    current.addedLines.push({ line: hunkLine, text: line.slice(1) })
    return { hunkLine: hunkLine + 1 }
  }
  if (kind === 'deleted') {
    current.deletions += 1
    return { hunkLine }
  }
  if (kind === 'context') return { hunkLine: hunkLine + 1 }
  return { hunkLine }
}

/** diff 行分类（file/binary/hunk/added/deleted/context/other）。 */
function classifyLine(line: string): LineKind {
  if (line.startsWith('diff --git ')) return 'file'
  if (line.startsWith('Binary files ')) return 'binary'
  if (line.startsWith('@@ ')) return 'hunk'
  if (line.startsWith('+') && !line.startsWith('+++')) return 'added'
  if (line.startsWith('-') && !line.startsWith('---')) return 'deleted'
  if (line.startsWith(' ')) return 'context'
  return 'other'
}

/** 文件路径：`diff --git a/x b/y` → y（b/ 前缀剥除）。 */
function pathOf(line: string): string {
  const parts = line.split(' ')
  const b = parts[parts.length - 1] ?? ''
  return b.startsWith('b/') ? b.slice(2) : b
}

/** hunk 起始行号：`@@ -1,3 +10,4 @@` → 10（新文件侧）。 */
function hunkLineOf(line: string): number {
  const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  return match !== null ? Number(match[1]) : 0
}

/** 是否为测试文件（路径含 test/spec 标记）。 */
export function isTestFile(path: string): boolean {
  return /(^|\/)(test|tests|__tests__|spec)(\/|$)/.test(path) || /\.(test|spec)\./.test(path)
}

/** 是否为源码文件（排除纯文档/配置类；无扩展名视为源码）。 */
export function isSourceFile(path: string): boolean {
  if (isTestFile(path)) return false
  return !/\.(md|txt|json|yml|yaml|lock|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/.test(path)
}
