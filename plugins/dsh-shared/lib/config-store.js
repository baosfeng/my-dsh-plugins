/**
 * dsh-shared — 配置持久化（issue #27 配置可视化；由 dsh-my-notify /
 * dsh-task-reliability 的 lib/config-store.js 抽取合并，issue #45）。
 *
 * DSH 插件配置 = cordis loader patch 行的 `config` 字段。用户层 patch
 * 文件为 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（profile 层）与
 * `$DSH_HOME/cordis.patch.yml`（home 层）；DSH 的 watchUserPatches 通过
 * hmr.registerConfig 监听文件变化并热重载（无需重启）。
 *
 * 本模块把设置页保存的配置写入 profile 层 patch 文件：
 *  - 删除该行 id 的旧条目（行首 `- id: <rowId>` 到下一个顶层条目）；
 *  - 追加新条目（`- id: <rowId>` + `config:` 块，YAML 子集序列化）；
 *  - 原子写（tmp+rename），不破坏文件中的其他条目。
 *
 * 读取侧：extractConfig 解析 YAML 子集（布尔/整数/字符串/数组），供
 * 测试模拟「重启后 loader 重新解析 patch 文件」的闭环。
 */
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
/** Profile 名：进程参数 --profile 优先，否则默认 web（与 dsh-my-plugin-manager 同契约）。 */
export function currentProfile() {
    const argv = process.argv;
    const idx = argv.indexOf('--profile');
    if (idx !== -1 && typeof argv[idx + 1] === 'string' && argv[idx + 1] !== '')
        return argv[idx + 1];
    return 'web';
}
/** Profile 目录：$DSH_HOME/profiles/<profile>（fallback ~/.dsh/profiles/…）。 */
export function profileDirOf(profile) {
    const home = process.env.DSH_HOME;
    const base = typeof home === 'string' && home !== '' ? `${home}/profiles` : `${homedir()}/.dsh/profiles`;
    return join(base, profile);
}
/** 用户层 patch 文件路径（watchUserPatches 监听的 profile 层文件）。 */
export function patchFileOf(profile) {
    return join(profileDirOf(profile), 'cordis.patch.yml');
}
// ── 读取：YAML 子集解析 ────────────────────────────────────────────────────
/** 从 patch 文件文本提取指定行 id 的 config 块；无条目/无 config 返回 undefined。 */
export function extractConfig(text, rowId) {
    const lines = text.split('\n');
    const start = lines.findIndex((line) => line === `- id: ${rowId}`);
    if (start === -1)
        return undefined;
    for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (isTopLevelEntry(line))
            break;
        if (line === '  config:')
            return parseConfigBlock(lines, i + 1);
    }
    return undefined;
}
/** 解析 config 块（缩进 4 空格的 `key: value` 行，直到缩进不足/顶层条目）。 */
function parseConfigBlock(lines, from) {
    const config = {};
    for (let i = from; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === '' || line.startsWith('#'))
            continue;
        if (isTopLevelEntry(line) || !line.startsWith('    '))
            break;
        // 注意：冒号后不用 `\s*`（与 `(.*)` 字符集重叠 → CodeQL js/polynomial-redos）；
        // 改为 `(.*)` 直接捕获冒号后全部内容，前导空白由 parseYamlScalar 的 trim 处理，行为等价。
        const match = line.match(/^ {4}([A-Za-z0-9_]+):(.*)$/);
        if (match === null)
            continue;
        const value = parseYamlScalar(match[2]);
        if (value !== undefined)
            config[match[1]] = value;
    }
    return config;
}
/** 解析 YAML 标量子集：布尔 / 整数 / 数组（flow）/ 引号字符串 / 裸字符串。 */
function parseYamlScalar(raw) {
    const value = raw.trim();
    if (value === '')
        return undefined;
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    if (value === 'null')
        return null;
    if (isNumeric(value))
        return Number(value);
    if (isFlowArray(value))
        return parseFlowArray(value);
    return parseStringScalar(value);
}
function isNumeric(value) {
    return /^-?\d+(\.\d+)?$/.test(value);
}
function isFlowArray(value) {
    return value.startsWith('[') && value.endsWith(']');
}
function parseFlowArray(value) {
    return value
        .slice(1, -1)
        .split(',')
        .map((item) => parseYamlScalar(item))
        .filter((item) => item !== undefined);
}
function parseStringScalar(value) {
    if (value.startsWith("'") && value.endsWith("'"))
        return value.slice(1, -1).replace(/''/g, "'");
    if (value.startsWith('"') && value.endsWith('"'))
        return value.slice(1, -1);
    return value;
}
// ── 写入：删除旧条目 + 追加新条目（原子写） ───────────────────────────────
/** 把 config 写入 patch 文件：删除同 id 旧条目，追加新条目，原子写。 */
export async function writePatchConfig(file, rowId, config) {
    let text = '';
    try {
        text = await readFile(file, 'utf8');
    }
    catch {
        // first write: file does not exist yet
    }
    const lines = text.split('\n');
    const kept = [];
    let i = 0;
    while (i < lines.length) {
        if (isEntryStart(lines[i], rowId)) {
            // 跳过该条目：起始行 + 到下一个顶层条目之间的内容行
            i += 1;
            while (i < lines.length && !isTopLevelEntry(lines[i]))
                i += 1;
            continue;
        }
        kept.push(lines[i]);
        i += 1;
    }
    const body = kept.join('\n').trimEnd();
    const entry = renderEntry(rowId, config);
    const next = body === '' ? entry : `${body}\n${entry}`;
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, next, 'utf8');
    await rename(tmp, file);
}
/** 该行是否为指定行 id 的顶层条目起始行。 */
function isEntryStart(line, rowId) {
    return line === `- id: ${rowId}`;
}
/** 顶层条目判断：行首 `- `（无缩进；嵌套 `- item` 有缩进，不算）。 */
function isTopLevelEntry(line) {
    return line.startsWith('- ');
}
/** 渲染 `- id: <rowId>` + `config:` 块（YAML 子集序列化）。 */
function renderEntry(rowId, config) {
    const lines = [`- id: ${rowId}`, '  config:'];
    for (const [key, value] of Object.entries(config)) {
        lines.push(`    ${key}: ${yamlValue(value)}`);
    }
    return lines.join('\n');
}
/** YAML 标量序列化：字符串单引号（`'` → `''`），数组 flow 风格。 */
function yamlValue(value) {
    if (typeof value === 'string')
        return `'${value.replace(/'/g, "''")}'`;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (Array.isArray(value))
        return `[${value.map(yamlValue).join(', ')}]`;
    return 'null';
}
