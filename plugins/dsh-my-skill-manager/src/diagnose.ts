/**
 * dsh-my-skill-manager — skill directory scanning + diagnostics.
 *
 * 官方 filesystem provider（dsh-skill-filesystem）在 host 层默认被禁用
 * （dsh-web-app 的 patch：presets own local discovery），因此 host 层
 * `ctx.skills.list({ cwd })` 的 catalog 不含 filesystem skills。本模块在
 * 插件侧独立扫描同一批根目录，产出：
 *  - skills：frontmatter 正常的目录条目（name/description/source），供列表
 *    补充显示（标记未收录，见 api-route.js）；
 *  - issues：被官方扫描器跳过的异常条目（符号链接异常 / frontmatter 缺失 /
 *    缺 SKILL.md / 缺 name/description / 非法名字），供面板诊断提示。
 *
 * 根目录集合与官方默认 roots 保持一致：
 *  - 全局视图：$DSH_HOME/skills（user-dsh）、$DSH_AGENTS_HOME|~/.agents/skills（user-agents）
 *  - 项目视图：额外加上 <projectRoot>/.dsh/skills（project-dsh）、
 *    <projectRoot>/.agents/skills（project-agents）
 * customSkillDirs / bundledSkillDir 是 filesystem provider 的配置，插件侧
 * 无法得知，不纳入扫描（宁可漏报也不误报）。
 *
 * frontmatter 解析是轻量实现（无 yaml 依赖），只提取 name/description 字段；
 * 与官方 yaml 解析的差异只影响个别条目的收录判定，不改变诊断原因分类。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import type { Dirent, Stats } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findProjectRoot } from 'dsh-shared'

/** 官方 skill 名语法：kebab-case（与 dsh-skill 的 SKILL_NAME 一致）。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 一个 skill 根目录（path + 官方 source 值）。 */
export interface SkillRoot {
  path: string
  source: string
}

/** 扫描到的正常条目。 */
export interface ScannedSkill {
  name: string
  description: string
  source: string
  path: string
}

/** 扫描到的异常条目（诊断原因）。 */
export interface ScanIssue {
  name: string
  path: string
  reason: string
}

/** 扫描结果。 */
export interface ScanResult {
  skills: ScannedSkill[]
  issues: ScanIssue[]
}

/** 单个条目的判定结果：正常 → skill；异常 → issue；非 skill → undefined。 */
type EntryResult = { skill: ScannedSkill; issue?: undefined } | { issue: ScanIssue; skill?: undefined } | undefined

/** frontmatter 提取结果（缺字段为 undefined）。 */
interface FrontmatterFields {
  name: string | undefined
  description: string | undefined
}

/** 当前视图的 skill 根目录（cwd 为 undefined 时是全局视图）。 */
export async function viewRootsOf(cwd?: string): Promise<SkillRoot[]> {
  const roots: SkillRoot[] = [
    { path: join(dshHome(), 'skills'), source: 'user-dsh' },
    { path: join(agentsHome(), 'skills'), source: 'user-agents' },
  ]
  if (cwd !== undefined) {
    const projectRoot = await findProjectRoot(cwd)
    roots.push(
      { path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh' },
      { path: join(projectRoot, '.agents', 'skills'), source: 'project-agents' },
    )
  }
  return roots
}

function dshHome(): string {
  const home = process.env.DSH_HOME
  return typeof home === 'string' && home !== '' ? home : `${homedir()}/.dsh`
}

function agentsHome(): string {
  const home = process.env.DSH_AGENTS_HOME
  return typeof home === 'string' && home !== '' ? home : `${homedir()}/.agents`
}

/**
 * 扫描 roots：返回 { skills, issues }。
 * skills：frontmatter 正常的条目 [{ name, description, source, path }]；
 * issues：异常条目 [{ name, path, reason }]（reason 见 scanFile）。
 */
export async function scanSkillRoots(roots: SkillRoot[]): Promise<ScanResult> {
  const skills: ScannedSkill[] = []
  const issues: ScanIssue[] = []
  for (const root of roots) {
    let entries: Dirent[]
    try {
      entries = await readdir(root.path, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      continue // 目录不存在或不可读：官方同样跳过，不扫描
    }
    for (const entry of entries) {
      if (entry.name === '.system') continue
      const result = await scanEntry(join(root.path, entry.name), entry, root.source)
      if (result === undefined) continue
      if (result.issue !== undefined) issues.push(result.issue)
      else skills.push(result.skill)
    }
  }
  return { skills, issues }
}

/** 判定一个目录条目：返回 { skill } / { issue } / undefined（非 skill 条目）。 */
async function scanEntry(fullPath: string, entry: Dirent, source: string): Promise<EntryResult> {
  // Dirent 的 isDirectory/isFile 不跟随符号链接；对 symlink 用 stat 结果判断。
  let info: Stats | undefined
  if (entry.isSymbolicLink()) {
    try {
      info = await stat(fullPath)
    } catch {
      return { issue: { name: entry.name, path: fullPath, reason: 'broken-symlink' } }
    }
  }
  const isDir = info !== undefined ? info.isDirectory() : entry.isDirectory()
  const isFile = info !== undefined ? info.isFile() : entry.isFile()
  if (isDir) {
    let raw: string
    try {
      raw = await readFile(join(fullPath, 'SKILL.md'), 'utf8')
    } catch {
      return { issue: { name: entry.name, path: fullPath, reason: 'missing-skills-md' } }
    }
    return scanFile(entry.name, fullPath, raw, source)
  }
  if (isFile && entry.name.endsWith('.md')) {
    let raw: string
    try {
      raw = await readFile(fullPath, 'utf8')
    } catch {
      return undefined // 不可读：官方同样跳过，无更多信息可给
    }
    return scanFile(entry.name.slice(0, -3), fullPath, raw, source)
  }
  return undefined // 非 skill 条目（官方同样静默跳过）
}

/** 按 frontmatter 内容判定：正常 → { skill }；异常 → { issue }。 */
function scanFile(entryName: string, fullPath: string, raw: string, source: string): EntryResult {
  const fields = parseFrontmatterFields(raw)
  if (fields === undefined) return { issue: { name: entryName, path: fullPath, reason: 'missing-frontmatter' } }
  if (fields.name === undefined || fields.description === undefined) {
    return { issue: { name: entryName, path: fullPath, reason: 'missing-name-description' } }
  }
  if (!SKILL_NAME.test(fields.name)) return { issue: { name: entryName, path: fullPath, reason: 'invalid-name' } }
  return { skill: { name: fields.name, description: fields.description, source, path: fullPath } }
}

/** 轻量 frontmatter 解析：只提取 name/description；结构异常返回 undefined。 */
function parseFrontmatterFields(raw: string): FrontmatterFields | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  const closing = findClosingFrontmatter(raw, firstLineEnd + 1)
  if (closing === undefined) return undefined
  const block = raw.slice(firstLineEnd + 1, closing)
  return {
    name: fieldValue(block, 'name'),
    description: fieldValue(block, 'description'),
  }
}

function findClosingFrontmatter(raw: string, start: number): number | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') return lineStart
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

/** 提取 frontmatter 块中 `key: value` 的标量值（去引号）；缺失返回 undefined。 */
function fieldValue(block: string, key: string): string | undefined {
  const match = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  if (match === null) return undefined
  const value = match[1].trim()
  if (value === '') return undefined
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}
