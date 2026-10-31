/**
 * dsh-my-skill-manager — skill 目录扫描与诊断。
 *
 * 官方 filesystem provider 在 host 层默认不参与发现（presets 各自拥有本地
 * 发现），因此插件侧独立扫描与官方一致的根目录，产出两类结果：
 *  - skills：frontmatter 正常的条目（name / description / source / path），
 *    供 catalog 合并出「未被官方 catalog 收录」的行；
 *  - issues：被官方扫描器跳过的异常条目，作为诊断数据给面板展示。
 *
 * 根目录集合与官方默认 roots 一致（见 catalog.ts 的 userSkillRoots /
 * projectSkillRoots）：
 *  - 全局：$DSH_HOME/skills（user-dsh）、$DSH_AGENTS_HOME/skills（user-agents）
 *  - 项目：<root>/.dsh/skills（project-dsh）、<root>/.agents/skills（project-agents）
 *
 * frontmatter 解析是轻量实现（无 yaml 依赖），只提取 name / description；
 * 差异只影响个别条目的收录判定，不改变诊断原因分类。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
/** 官方 skill 名语法：kebab-case（与宿主 SKILL_NAME 一致）。 */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** 正文文件名。 */
export const SKILL_FILE_NAME = 'SKILL.md';
/** 全部原因码（稳定顺序，供测试/文档引用）。 */
export const DIAGNOSTIC_REASONS = [
    'broken-symlink',
    'missing-skill-md',
    'missing-frontmatter',
    'invalid-name',
    'parse-failed',
];
/** 读一条 `key: value` 标量（去引号；空值视为缺失）。 */
function fieldValue(block, key) {
    const match = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    if (match === null)
        return undefined;
    const value = match[1].trim();
    if (value === '')
        return undefined;
    if (value.startsWith('"') && value.endsWith('"'))
        return value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'"))
        return value.slice(1, -1);
    return value;
}
/** 解析 frontmatter：缺首行 `---` → missing；无收尾 → malformed；否则取字段。 */
export function parseFrontmatter(raw) {
    const firstLineEnd = raw.indexOf('\n');
    if (firstLineEnd < 0)
        return { kind: 'missing' };
    if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---')
        return { kind: 'missing' };
    const closing = findClosingFence(raw, firstLineEnd + 1);
    if (closing === undefined)
        return { kind: 'malformed' };
    const block = raw.slice(firstLineEnd + 1, closing);
    return { kind: 'ok', fields: { name: fieldValue(block, 'name'), description: fieldValue(block, 'description') } };
}
/** 找 frontmatter 收尾行（`---`）的起始下标。 */
function findClosingFence(raw, start) {
    let lineStart = start;
    while (lineStart <= raw.length) {
        const nextNewline = raw.indexOf('\n', lineStart);
        const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
        if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---')
            return lineStart;
        if (nextNewline < 0)
            return undefined;
        lineStart = nextNewline + 1;
    }
    return undefined;
}
/** 按内容判定一个 skill 条目：正常 → skill；异常 → 诊断原因。 */
export function classifySkillEntry(input) {
    const parsed = parseFrontmatter(input.raw);
    if (parsed.kind === 'missing')
        return { kind: 'issue', reason: 'missing-frontmatter' };
    if (parsed.kind === 'malformed')
        return { kind: 'issue', reason: 'parse-failed' };
    const name = parsed.fields.name;
    const description = parsed.fields.description;
    if (name === undefined || description === undefined)
        return { kind: 'issue', reason: 'parse-failed' };
    if (!SKILL_NAME_RE.test(name))
        return { kind: 'issue', reason: 'invalid-name' };
    return { kind: 'skill', name, description };
}
/** 扫描一个条目：目录 / .md 文件 / 坏符号链接。 */
async function scanEntry(fullPath, isDir, isFile, isSymlink, source) {
    let info;
    if (isSymlink) {
        try {
            info = await stat(fullPath);
        }
        catch {
            return { issue: { name: basenameOf(fullPath), path: fullPath, reason: 'broken-symlink' } };
        }
    }
    const targetIsDir = info !== undefined ? info.isDirectory() : isDir;
    const targetIsFile = info !== undefined ? info.isFile() : isFile;
    if (targetIsDir) {
        let raw;
        try {
            raw = await readFile(join(fullPath, SKILL_FILE_NAME), 'utf8');
        }
        catch {
            return { issue: { name: basenameOf(fullPath), path: fullPath, reason: 'missing-skill-md' } };
        }
        return toEntry(basenameOf(fullPath), fullPath, raw, source);
    }
    if (targetIsFile && fullPath.endsWith('.md')) {
        let raw;
        try {
            raw = await readFile(fullPath, 'utf8');
        }
        catch {
            return undefined; // 不可读：无更多信息可给，官方同样跳过
        }
        return toEntry(basenameOf(fullPath).slice(0, -3), fullPath, raw, source);
    }
    return undefined; // 非 skill 条目
}
/** 把内容判定结论转成扫描结果条目。 */
function toEntry(entryName, fullPath, raw, source) {
    const result = classifySkillEntry({ entryName, raw });
    if (result.kind === 'issue')
        return { issue: { name: entryName, path: fullPath, reason: result.reason } };
    return { skill: { name: result.name, description: result.description, source, path: fullPath } };
}
/** 路径最后一段（避免再依赖 node:path 只为这一处）。 */
function basenameOf(path) {
    const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
    const index = trimmed.lastIndexOf('/');
    return index < 0 ? trimmed : trimmed.slice(index + 1);
}
/**
 * 扫描一组根目录，返回 { skills, issues }。
 * 不存在的根目录直接跳过（官方同样跳过），不产生诊断噪音。
 */
export async function scanSkillRoots(roots) {
    const skills = [];
    const issues = [];
    for (const root of roots) {
        let entries;
        try {
            entries = await readdir(root.path, { withFileTypes: true, encoding: 'utf8' });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.name === '.system')
                continue;
            const result = await scanEntry(join(root.path, entry.name), entry.isDirectory(), entry.isFile(), entry.isSymbolicLink(), root.source);
            if (result === undefined)
                continue;
            if ('issue' in result)
                issues.push(result.issue);
            else
                skills.push(result.skill);
        }
    }
    return { skills, issues };
}
