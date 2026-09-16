/**
 * dsh-my-guard — tar 解包前的 entry 校验（CodeQL #104 / #105 加固）。
 *
 * 为什么不能只靠系统 tar：`scanTarball` 解包的是**攻击者可控**的 tarball（registry 下载的
 * 包 / `/scan` 传入的 .tgz）。`..`、绝对路径、软硬链接逃逸到底会不会被拦，取决于跑在哪个
 * tar 实现上——实测 bsdtar 3.5 会拦 `..` 与软链穿越，但对绝对路径只剥掉 `/` 前缀后**照常
 * 落盘**，GNU tar / busybox tar 的版本差异同样是未知数。安全属性不能外包给外部实现的版本
 * 行为，所以这里在解包**之前**自己把整份 tar 的头走一遍，逐个 entry 判定，命中任何一条
 * 可疑即 fail-closed（认不出的结构也拒绝）。
 *
 * 第二条收益是解压炸弹：tar 按 header 声明的 size 把字节全部写盘，而扫描侧的
 * `MAX_SCAN_FILE_BYTES` 只限制**读取**上限——1 KB 的压缩包可以声明若干 GiB 把临时盘写满。
 * 这里按声明体积累计设上限，并在**读取该 entry 的数据块之前**判定，超限即拒绝。
 *
 * 解析的是 tar 物理格式（512 字节 header + 数据块 + 结束零块），包含会改写后续 entry 名字/
 * 体积的元数据 entry（GNU `L`/`K` 长名、PAX `x`/`g` 的 `path=`/`size=`）——否则攻击者把逃逸
 * 路径藏进元数据就能绕过校验。元数据只被理解为「覆盖下一个（或全局的）entry 属性」。
 */
import { posix } from 'node:path';
import { createGunzip } from 'node:zlib';
/** tar 逻辑块大小（POSIX 固定 512 字节）。 */
const BLOCK = 512;
/** 元数据 entry（长名 / pax 记录）体积上限：真实用例都在几 KB 内，超大即视为构造。 */
const MAX_META_BYTES = 64 * 1024;
/** 声明解包体积上限：超过即拒绝解包（防解压炸弹写满临时盘）。 */
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
/** 会改写后续 entry 属性的元数据类型。 */
const METADATA_TYPES = new Set(['L', 'K', 'x', 'g']);
/** 允许解包的类型：普通文件 / 硬链 / 软链 / 目录 / 连续文件（V7）。设备节点等一律拒绝。 */
const ALLOWED_TYPES = new Set(['0', '1', '2', '5', '7']);
/**
 * 流式校验一份（gzip 压缩的）tar；只读不写，任何可疑都 fail-closed。
 * 调用方拿到 `ok:true` 后再交给 tar 解包——校验与解包读的是**同一份字节**，不存在 TOCTOU。
 */
export async function inspectTarStream(source, maxUnpackedBytes = MAX_UNPACKED_BYTES) {
    const reader = new BlockReader(source.pipe(createGunzip()));
    // 全局（`g`）覆盖作用于其后所有 entry；局部（`L`/`K`/`x`）只作用于紧接着的下一个。
    const globalOverrides = {};
    let pending = {};
    let total = 0;
    try {
        for (;;) {
            const block = await reader.take(BLOCK);
            if (block === null)
                return { ok: true };
            if (isZeroBlock(block))
                continue; // 结束零块与尾部填充
            const parsed = parseHeader(block);
            if (!parsed.ok)
                return parsed;
            const entry = applyOverride(parsed.entry, { ...globalOverrides, ...pending });
            pending = {};
            const step = await checkEntry(reader, entry, total, maxUnpackedBytes);
            if (!step.ok)
                return step;
            // 覆盖只写进**新的** pending / 全局对象里（旧对象已随上面的重置失效，避免串到后续 entry）
            if (step.override !== undefined)
                Object.assign(parsed.entry.type === 'g' ? globalOverrides : pending, step.override);
            total += entry.size;
        }
    }
    catch (error) {
        return { ok: false, reason: `tar 结构非法（${textOf(error)}）` };
    }
}
/** 单个 entry 的判定 + 推进：先体积、再安全规则，最后按类型读元数据或跳过数据块。 */
async function checkEntry(reader, entry, used, maxUnpackedBytes) {
    const blocks = blocksOf(entry.size);
    if (used + entry.size > maxUnpackedBytes)
        return { ok: false, reason: overDeclared(used + entry.size, maxUnpackedBytes) };
    if (METADATA_TYPES.has(entry.type)) {
        if (entry.size > MAX_META_BYTES)
            return { ok: false, reason: `tar 元数据 entry 体积异常（${entry.size} 字节）` };
        const data = await reader.take(entry.size);
        if (data === null || !(await reader.skip(blocks - entry.size)))
            return { ok: false, reason: 'tar 数据块不完整（截断）' };
        return metadataPatch(entry, data);
    }
    const unsafe = unsafeReason(entry);
    if (unsafe !== null)
        return { ok: false, reason: unsafe };
    if (!(await reader.skip(blocks)))
        return { ok: false, reason: 'tar 数据块不完整（截断）' };
    return { ok: true };
}
/** 解包体积超限的拒绝原因（累计声明体积 + 上限换算成 MiB，便于用户判断）。 */
function overDeclared(total, limit) {
    return `声明解包体积累计 ${total} 字节超过上限 ${Math.floor(limit / (1024 * 1024))} MiB，拒绝解包（防解压炸弹）`;
}
/** entry 是否不安全；返回拒绝原因或 `null`。 */
function unsafeReason(entry) {
    const named = unsafeNameReason(entry.name);
    if (named !== null)
        return named;
    if (entry.type === '2')
        return unsafeLinkReason(entry, '符号链接');
    if (entry.type === '1')
        return unsafeLinkReason(entry, '硬链接');
    if (!ALLOWED_TYPES.has(entry.type))
        return `不支持的 tar entry 类型 ${JSON.stringify(entry.type)}`;
    return null;
}
/** 名字层面的通用规则：绝对路径 / 盘符 / 反斜杠分隔符 / `..` 穿越。 */
function unsafeNameReason(name) {
    if (name === '')
        return 'tar entry 名为空';
    if (name.includes('\0'))
        return 'tar entry 名含 NUL 字节';
    if (name.startsWith('/'))
        return `tar entry 使用绝对路径（${clip(name)}）`;
    if (/^[A-Za-z]:/.test(name))
        return `tar entry 使用 Windows 盘符（${clip(name)}）`;
    if (name.includes('\\'))
        return `tar entry 名含反斜杠分隔符（${clip(name)}）`;
    if (name.split('/').includes('..'))
        return `tar entry 路径穿越（${clip(name)}）`;
    return null;
}
/** 软/硬链接目标必须落在解包目录内（软链按所在目录解析，硬链按归档根解析）。 */
function unsafeLinkReason(entry, kind) {
    const { link } = entry;
    const suspicious = link === '' ||
        link.startsWith('/') ||
        /^[A-Za-z]:/.test(link) ||
        link.includes('\\') ||
        resolvedTarget(entry, kind).startsWith('..');
    if (!suspicious)
        return null;
    return `${kind}目标逃逸解包目录（${clip(entry.name)} -> ${clip(link)}）`;
}
/** 链接目标归一化后的相对路径（相对解包根）。 */
function resolvedTarget(entry, kind) {
    if (kind === '硬链接')
        return posix.normalize(entry.link);
    return posix.normalize(posix.join(posix.dirname(entry.name), entry.link));
}
/** 解析元数据 entry：GNU 长名 / 长链接目标，或 PAX 的 `path`·`linkpath`·`size` 记录。 */
function metadataPatch(entry, data) {
    const text = data.toString('utf8').replace(/\0+$/, '');
    if (entry.type === 'L')
        return { ok: true, override: { name: text } };
    if (entry.type === 'K')
        return { ok: true, override: { link: text } };
    const records = parsePax(text);
    if (!records.ok)
        return records;
    const override = {};
    for (const [key, value] of Object.entries(records.value)) {
        if (key === 'path')
            override.name = value;
        else if (key === 'linkpath')
            override.link = value;
        else if (key === 'size') {
            const size = Number(value);
            if (!Number.isSafeInteger(size) || size < 0)
                return { ok: false, reason: `PAX size 记录非法（${clip(value)}）` };
            override.size = size;
        }
    }
    return { ok: true, override };
}
/** 解析 PAX 记录（`<len> <key>=<value>\n`）；格式非法即拒绝。 */
function parsePax(text) {
    const records = {};
    let rest = text;
    while (rest !== '') {
        const space = rest.indexOf(' ');
        const length = Number(rest.slice(0, space));
        if (space < 0 || !Number.isSafeInteger(length) || length <= space + 1 || length > rest.length) {
            return { ok: false, reason: `PAX 记录格式非法（${clip(rest.slice(0, 32))}）` };
        }
        const record = rest.slice(space + 1, length - 1);
        const eq = record.indexOf('=');
        if (eq <= 0)
            return { ok: false, reason: `PAX 记录缺少 key（${clip(record)}）` };
        records[record.slice(0, eq)] = record.slice(eq + 1);
        rest = rest.slice(length);
    }
    return { ok: true, value: records };
}
/** 合并覆盖：只覆盖被显式声明的字段。 */
function applyOverride(entry, overrides) {
    return {
        name: overrides.name ?? entry.name,
        link: overrides.link ?? entry.link,
        size: Math.max(entry.size, overrides.size ?? 0),
        type: entry.type,
    };
}
/** 解析 512 字节 header：校验和、名字（含 ustar prefix）、类型、体积、链接目标。 */
function parseHeader(block) {
    if (!checksumOk(block))
        return { ok: false, reason: 'tar header 校验和不符（结构非法）' };
    const size = parseNumber(block.subarray(124, 136));
    if (size === null)
        return { ok: false, reason: 'tar header size 字段非法' };
    const name = joinPrefix(cstr(block, 0, 100), cstr(block, 345, 155));
    const type = (block[156] === 0 ? '0' : String.fromCharCode(block[156]));
    return { ok: true, entry: { name, link: cstr(block, 157, 100), size, type } };
}
/** ustar `prefix` 与 `name` 拼接（GNU tar 同样如此），否则逃逸路径可藏在 prefix 里。 */
function joinPrefix(name, prefix) {
    return prefix === '' ? name : `${prefix}/${name}`;
}
/** header 校验和：chksum 字段按空格计入。 */
function checksumOk(block) {
    const declared = parseNumber(block.subarray(148, 156));
    if (declared === null)
        return false;
    let sum = 0;
    for (let index = 0; index < BLOCK; index += 1) {
        sum += index >= 148 && index < 156 ? 0x20 : block[index];
    }
    return sum === declared;
}
/** 八进制字段解析（GNU base-256 大数写法也接受）；非法返回 null。 */
function parseNumber(field) {
    if ((field[0] & 0x80) !== 0) {
        let value = field[0] & 0x7f;
        for (let index = 1; index < field.length; index += 1)
            value = value * 256 + field[index];
        return Number.isSafeInteger(value) ? value : null;
    }
    const text = field.toString('ascii').replace(/\0.*$/s, '').trim();
    if (text === '')
        return 0;
    if (!/^[0-7]+$/.test(text))
        return null;
    return Number.parseInt(text, 8);
}
/** 取 NUL 结尾字符串。 */
function cstr(block, offset, length) {
    const field = block.subarray(offset, offset + length);
    const end = field.indexOf(0);
    return field.subarray(0, end < 0 ? field.length : end).toString('utf8');
}
/** 数据块数（含填充）。 */
function blocksOf(size) {
    return Math.ceil(size / BLOCK) * BLOCK;
}
/** 全零块 = 结束标记 / 填充。 */
function isZeroBlock(block) {
    for (const byte of block)
        if (byte !== 0)
            return false;
    return true;
}
/** 拒绝原因里的字段值截断（防止把整段恶意名字刷进告警）。 */
function clip(value) {
    return value.length <= 80 ? value : `${value.slice(0, 80)}…`;
}
function textOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** 按需从流里取/跳字节的小缓冲读取器（内存只保留一个未消费的 chunk）。 */
class BlockReader {
    buffered = Buffer.alloc(0);
    iterator;
    constructor(stream) {
        this.iterator = stream[Symbol.asyncIterator]();
    }
    /** 取 n 字节；流提前结束返回 null。 */
    async take(size) {
        while (this.buffered.length < size) {
            const next = await this.iterator.next();
            if (next.done === true)
                return null;
            this.buffered = this.buffered.length === 0 ? next.value : Buffer.concat([this.buffered, next.value]);
        }
        const taken = this.buffered.subarray(0, size);
        this.buffered = this.buffered.subarray(size);
        return taken;
    }
    /** 跳过 n 字节；不足返回 false。 */
    async skip(size) {
        let left = size;
        while (left > 0) {
            const chunk = await this.take(Math.min(left, 64 * 1024));
            if (chunk === null)
                return false;
            left -= chunk.length;
        }
        return true;
    }
}
