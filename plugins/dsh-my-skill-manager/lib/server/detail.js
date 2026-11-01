/**
 * dsh-my-skill-manager — SKILL.md 只读预览。
 *
 * 白名单：只允许读取 user/project skill 根目录下的 SKILL.md（与扫描根一致）。
 * 防护：
 *  - name 必须符合 kebab-case（天然排除 `/`、`..` 等）；
 *  - 候选路径先 realpath，再校验落在根目录内（挡住符号链接逃逸）；
 *  - 读取上限 256KB，超出截断并置 truncated:true（不整文件读入，避免大文件
 *    把进程内存拉高）；
 *  - 类型判定 / 大小 / 内容全部取自**同一个 fd**（open → handle.stat() → handle.read），
 *    不再「按名 stat 取 size 后再按名 open 读内容」（CodeQL js/file-system-race #121）。
 */
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { skillRootsOf } from './catalog.js';
import { SKILL_FILE_NAME, SKILL_NAME_RE } from './diagnostics.js';
/** 正文读取上限：256KB。 */
export const MAX_DETAIL_BYTES = 256 * 1024;
/** 详情读取失败（带稳定错误码）。 */
export class DetailError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'DetailError';
        this.code = code;
    }
}
/** 路径类错误：realpath 之后、open 之前文件消失，按未命中处理而不是升级成 500。 */
function isVanished(error) {
    const code = error?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}
/**
 * 读取有上限的文本：超过上限时只读前 256KB 并标记截断。
 *
 * 大小与内容必须同源于**一个 fd**：先 open，再用 handle.stat()（fstat）取 size，再用同一个
 * handle 读。旧写法「按名 stat 取 size → 按名 open 读内容」在两次按名解析之间留了窗口
 * （CodeQL #121）：窗口里文件被替换，truncated 会按旧 size 判定、内容却来自新 inode。
 * O_NONBLOCK：候选可能是 FIFO，O_RDONLY 无写端时会一直阻塞，类型判定交给 fstat
 * （同 scripts/check-links.mjs 的「open + fd stat + fd 读」）。
 *
 * 返回 null = 不是普通文件，或 open 时已消失（调用方继续下一个候选）。
 */
async function readCapped(file) {
    let handle;
    try {
        handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    }
    catch (error) {
        if (isVanished(error))
            return null;
        throw error;
    }
    try {
        const info = await handle.stat();
        if (!info.isFile())
            return null;
        const limit = Math.min(info.size, MAX_DETAIL_BYTES);
        const buffer = Buffer.alloc(limit);
        const { bytesRead } = await handle.read(buffer, 0, limit, 0);
        // 截断点可能落在多字节字符中间：去掉尾部的替换字符，避免显示成乱码。
        const content = buffer
            .subarray(0, bytesRead)
            .toString('utf8')
            .replace(/\uFFFD$/, '');
        return { content, truncated: info.size > MAX_DETAIL_BYTES };
    }
    finally {
        await handle.close();
    }
}
/** 候选文件是否位于根目录内（realpath 后比较，挡符号链接逃逸）。 */
function isInsideRoot(rootReal, fileReal) {
    return fileReal === rootReal || fileReal.startsWith(rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`);
}
/** 读取一个 skill 的 SKILL.md（name 必须命中白名单根；找不到抛 not-found）。 */
export async function readSkillDetail(input) {
    const name = input.name.trim();
    if (!SKILL_NAME_RE.test(name)) {
        throw new DetailError('invalid-name', `invalid skill name: "${input.name}"`);
    }
    const roots = await skillRootsOf(input.cwd);
    let sawOutside = false;
    for (const root of roots) {
        let rootReal;
        try {
            rootReal = await realpath(root.path);
        }
        catch {
            continue; // 根目录不存在：跳过
        }
        for (const candidate of [join(root.path, name, SKILL_FILE_NAME), join(root.path, `${name}.md`)]) {
            let fileReal;
            try {
                fileReal = await realpath(candidate);
            }
            catch {
                continue;
            }
            if (!isInsideRoot(rootReal, fileReal)) {
                sawOutside = true;
                continue;
            }
            // realpath 的结果直接作为打开目标（不回退 candidate）：类型 / 大小 / 内容
            // 都来自这一次 open 拿到的 fd，候选被替换或删除都不会读到另一个 inode。
            const detail = await readCapped(fileReal);
            if (detail === null)
                continue;
            return { name, path: fileReal, content: detail.content, truncated: detail.truncated };
        }
    }
    if (sawOutside)
        throw new DetailError('forbidden', `skill "${name}" resolves outside the allowed roots`);
    throw new DetailError('not-found', `skill "${name}" not found in allowed roots`);
}
