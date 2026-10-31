/**
 * dsh-my-skill-manager — SKILL.md 只读预览。
 *
 * 白名单：只允许读取 user/project skill 根目录下的 SKILL.md（与扫描根一致）。
 * 防护：
 *  - name 必须符合 kebab-case（天然排除 `/`、`..` 等）；
 *  - 候选路径先 realpath，再校验落在根目录内（挡住符号链接逃逸）；
 *  - 读取上限 256KB，超出截断并置 truncated:true（不整文件读入，避免大文件
 *    把进程内存拉高）。
 */
import { open, realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { skillRootsOf } from './catalog.js'
import { SKILL_FILE_NAME, SKILL_NAME_RE } from './diagnostics.js'

/** 正文读取上限：256KB。 */
export const MAX_DETAIL_BYTES = 256 * 1024

/** 详情错误码（HTTP 层映射 400 / 404）。 */
export type DetailErrorCode = 'invalid-name' | 'not-found' | 'forbidden'

/** 详情读取失败（带稳定错误码）。 */
export class DetailError extends Error {
  readonly code: DetailErrorCode

  constructor(code: DetailErrorCode, message: string) {
    super(message)
    this.name = 'DetailError'
    this.code = code
  }
}

/** GET /detail 的 value。 */
export interface SkillDetail {
  name: string
  path: string
  content: string
  truncated: boolean
}

/** 读取有上限的文本：超过上限时只读前 256KB 并标记截断。 */
async function readCapped(file: string): Promise<{ content: string; truncated: boolean }> {
  const info = await stat(file)
  const limit = Math.min(info.size, MAX_DETAIL_BYTES)
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(limit)
    const { bytesRead } = await handle.read(buffer, 0, limit, 0)
    // 截断点可能落在多字节字符中间：去掉尾部的替换字符，避免显示成乱码。
    const content = buffer
      .subarray(0, bytesRead)
      .toString('utf8')
      .replace(/\uFFFD$/, '')
    return { content, truncated: info.size > MAX_DETAIL_BYTES }
  } finally {
    await handle.close()
  }
}

/** 候选文件是否位于根目录内（realpath 后比较，挡符号链接逃逸）。 */
function isInsideRoot(rootReal: string, fileReal: string): boolean {
  return fileReal === rootReal || fileReal.startsWith(rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`)
}

/** 读取一个 skill 的 SKILL.md（name 必须命中白名单根；找不到抛 not-found）。 */
export async function readSkillDetail(input: { name: string; cwd?: string | undefined }): Promise<SkillDetail> {
  const name = input.name.trim()
  if (!SKILL_NAME_RE.test(name)) {
    throw new DetailError('invalid-name', `invalid skill name: "${input.name}"`)
  }
  const roots = await skillRootsOf(input.cwd)
  let sawOutside = false
  for (const root of roots) {
    let rootReal: string
    try {
      rootReal = await realpath(root.path)
    } catch {
      continue // 根目录不存在：跳过
    }
    for (const candidate of [join(root.path, name, SKILL_FILE_NAME), join(root.path, `${name}.md`)]) {
      let fileReal: string
      try {
        fileReal = await realpath(candidate)
      } catch {
        continue
      }
      if (!isInsideRoot(rootReal, fileReal)) {
        sawOutside = true
        continue
      }
      let info: Awaited<ReturnType<typeof stat>>
      try {
        info = await stat(fileReal)
      } catch {
        continue
      }
      if (!info.isFile()) continue
      const { content, truncated } = await readCapped(fileReal)
      return { name, path: fileReal, content, truncated }
    }
  }
  if (sawOutside) throw new DetailError('forbidden', `skill "${name}" resolves outside the allowed roots`)
  throw new DetailError('not-found', `skill "${name}" not found in allowed roots`)
}
