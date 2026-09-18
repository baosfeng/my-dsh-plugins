/**
 * dsh-my-remote — 设置页的 YAML 读写子集（issue #385）。
 *
 * 为什么本插件自带该行 config 的 YAML 读写，而不是直接用 dsh-shared 的
 * `extractConfig` / `writePatchConfig`：
 *
 *  1. `extractConfig` 只解析 4 空格缩进的**标量 / flow 数组**行；webhooks 是嵌套
 *     列表，它读不到（返回的 config 里没有 webhooks 键）。
 *  2. `writePatchConfig` 的 `yamlValue` 同样只认标量 / 数组，嵌套的 webhook 对象会
 *     被压成 `webhooks: [null]`（实测）——照搬会在保存一次后丢光用户的 webhook。
 *
 * 所以该行的解析与序列化由本模块负责，口径与 dsh-shared 保持一致：4 空格（config
 * 字段）/ 6 空格（webhook 条目）/ 8 空格（webhook 字段）/ 10 空格（headers 内层），
 * 字符串单引号（`'` → `''`），数组 flow 风格。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
/** 顶层条目起始行（`- id: xxx`），用于界定该行 config 块的范围。 */
const TOP_LEVEL = /^- /;
/** config 字段行：`    key: value`（4 空格）。 */
const SCALAR_LINE = /^ {4}([A-Za-z0-9_]+): ?(.*)$/;
/** webhook 条目首行：`      - name: x`（6 空格 + `- `）。 */
const RUN_HEAD = /^ {6}- ([A-Za-z0-9_]+): ?(.*)$/;
/** webhook 字段行：8 空格（条目字段）/ 10 空格（headers 内层），均可带 `- `。 */
const WEBHOOK_FIELD = /^ +(?:- )?([A-Za-z0-9_]+): ?(.*)$/;
/** 文件内容 → 该行 config 字典（无该条目 → 空字典）。 */
export function parseRowConfig(text, rowId) {
    const lines = configBlockLines(text, rowId);
    const config = {};
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === '    webhooks:') {
            let end = i + 1;
            while (end < lines.length && lines[end].startsWith('      '))
                end += 1;
            config.webhooks = parseWebhookLines(lines.slice(i + 1, end));
            i = end - 1;
            continue;
        }
        const scalar = scalarEntry(line);
        if (scalar !== undefined)
            config[scalar[0]] = scalar[1];
    }
    return config;
}
/** 读取该行已有配置（文件不存在 → 空字典，首次保存按空配置合并）。 */
export async function readRowConfig(file, rowId) {
    return parseRowConfig(await readFileOrEmpty(file), rowId);
}
/** 读取文件（不存在 → 空串）。 */
export async function readFileOrEmpty(file) {
    try {
        return await readFile(file, 'utf8');
    }
    catch {
        return '';
    }
}
/** 读取该行 config 块原文（无该条目 → 空数组）。 */
function configBlockLines(text, rowId) {
    const lines = text.split('\n');
    const start = lines.findIndex((line) => line === `- id: ${rowId}`);
    if (start === -1)
        return [];
    const out = [];
    for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (TOP_LEVEL.test(line))
            break;
        if (out.length === 0 && line !== '  config:')
            continue;
        out.push(line);
    }
    out.shift();
    return out;
}
/** 缩进 4 空格的标量行 → [key, value]；非标量行（如 `webhooks:`）返回 undefined。 */
function scalarEntry(line) {
    const match = line.match(SCALAR_LINE);
    if (match === null || match[2] === '')
        return undefined;
    return [match[1], parseScalarValue(match[2])];
}
/** YAML 标量子集解析（布尔 / 整数 / flow 数组 / 引号字符串 / 裸字符串）。 */
function parseScalarValue(raw) {
    const value = raw.trim();
    const literals = { true: true, false: false, null: null };
    if (value in literals)
        return literals[value];
    if (/^-?\d+$/.test(value))
        return Number(value);
    // flow 数组（`['ask', 'approval']`）：webhook 的 events 手写就是这个形态。
    if (value.startsWith('[') && value.endsWith(']')) {
        return value
            .slice(1, -1)
            .split(',')
            .map((item) => parseScalarValue(item))
            .filter((item) => item !== undefined && item !== '');
    }
    return parseStringValue(value);
}
/** 字符串标量解析（单引号 / 双引号 / 裸串）。 */
function parseStringValue(value) {
    if (value.startsWith("'") && value.endsWith("'"))
        return value.slice(1, -1).replace(/''/g, "'");
    if (value.startsWith('"') && value.endsWith('"'))
        return value.slice(1, -1);
    return value;
}
/** 解析 webhook 条目块（已按缩进切好：每行 6 空格起）。 */
function parseWebhookLines(lines) {
    const state = { entries: [] };
    for (const line of lines) {
        const item = line.match(RUN_HEAD);
        if (item !== null) {
            // `- name:` / `- url:` 是新条目（**必须带 `- `**，否则 8 空格的 `headers:`
            // 会被误判成新条目，headers 整段丢失）。
            if (item[1] === 'name' || item[1] === 'url')
                state.entry = newWebhookEntry(state);
            assignInto(state, item[1], item[2]);
            continue;
        }
        assignFieldLine(state, line);
    }
    return state.entries;
}
/** 开一条新条目并重置 headers 状态。 */
function newWebhookEntry(state) {
    const entry = {};
    state.entries.push(entry);
    state.headers = undefined;
    state.inHeaders = false;
    return entry;
}
/** 处理 8 / 10 空格字段行（含 `headers:` 段落切换）。 */
function assignFieldLine(state, line) {
    const field = line.match(WEBHOOK_FIELD);
    if (field === null)
        return;
    if (line.trim() === 'headers:') {
        state.inHeaders = true;
        return;
    }
    assignInto(state, field[1], field[2]);
}
/** 把键值写进当前条目（headers 段落内写 headers 字典）。 */
function assignInto(state, key, raw) {
    const entry = state.entry;
    if (entry === undefined)
        return;
    if (state.inHeaders === true) {
        state.headers ??= {};
        state.headers[key] = String(parseScalarValue(raw));
        entry.headers = state.headers;
        return;
    }
    entry[key] = parseScalarValue(raw);
}
// ── 序列化（与 dsh-shared writePatchConfig 同口径 + 嵌套列表）────────────
/** 序列化该行 config（未知 / 不可序列化值一律跳过，绝不写脏值进 patch）。 */
export function serializeConfigBlock(config) {
    const lines = [];
    for (const [key, value] of Object.entries(config)) {
        if (value === undefined)
            continue;
        if (key === 'webhooks' && Array.isArray(value)) {
            lines.push('    webhooks:');
            lines.push(...serializeWebhooks(value));
            continue;
        }
        if (value !== null && typeof value === 'object')
            continue;
        lines.push(`    ${key}: ${scalarText(value)}`);
    }
    return lines.join('\n');
}
/** YAML 标量序列化：字符串单引号（`'` → `''`），数组 flow 风格，对象 / 未知 → null。 */
function scalarText(value) {
    if (typeof value === 'string')
        return `'${value.replace(/'/g, "''")}'`;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (Array.isArray(value))
        return `[${value.map(scalarText).join(', ')}]`;
    return 'null';
}
/** 序列化 webhook 列表（`      - name: x` + 8 空格字段，headers 再深一层）。 */
function serializeWebhooks(webhooks) {
    const lines = [];
    for (const webhook of webhooks) {
        let first = true;
        for (const [key, value] of Object.entries(webhook)) {
            if (key === 'headers' || value === undefined)
                continue;
            lines.push(`${first ? '      - ' : '        '}${key}: ${scalarText(value)}`);
            first = false;
        }
        lines.push(...serializeHeaders(webhook.headers));
    }
    return lines;
}
/** 序列化 headers 内层（`        headers:` + 10 空格键值，非字符串值跳过）。 */
function serializeHeaders(headers) {
    if (headers === null || typeof headers !== 'object' || Array.isArray(headers))
        return [];
    const entries = Object.entries(headers).filter(([, value]) => typeof value === 'string');
    if (entries.length === 0)
        return [];
    return ['        headers:', ...entries.map(([key, value]) => `          ${key}: ${scalarText(value)}`)];
}
/**
 * 删除同 id 旧条目并在文件末尾追加新条目（原子写 tmp + rename）。
 *
 * 与 `writePatchConfig` 的差别只在「新条目文本由调用方渲染」——因为那一个无法写出
 * 嵌套 webhook 对象（见文件头）。
 */
export async function writeRowEntry(file, text, rowId, entry) {
    const kept = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i] !== `- id: ${rowId}`) {
            kept.push(lines[i]);
            continue;
        }
        i += 1;
        while (i < lines.length && !TOP_LEVEL.test(lines[i]) && lines[i] !== '')
            i += 1;
    }
    const body = kept.join('\n').trimEnd();
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, body === '' ? entry : `${body}\n${entry}`, 'utf8');
    await rename(tmp, file);
}
