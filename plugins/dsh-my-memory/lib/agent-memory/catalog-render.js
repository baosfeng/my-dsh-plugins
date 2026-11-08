/**
 * dsh-my-memory — 目录的**格式化与分组渲染**（从 catalog.ts 拆出：400 行门禁）。
 *
 * 纯函数，无 I/O：条目按「全局 / 项目」分组，组内按层级与活跃度决定展开多少条。
 * 预算（行数 / 字节）在 renderCatalog 里逐行累加，超了绝不静默丢——组内折叠
 * 给「…另有 N 条」，全局超预算给按文件点名的尾注。
 *
 * 分层策略：
 *  - 全局层（user.md / feedback.md）**全量**展开：跨项目生效，最该被想起；
 *  - 最近活跃项目展开 12 条、其余项目各 4 条：让「最近在干的那个项目」自然浮前；
 *  - 其余折叠成「…另有 N 条」，需要时 agent_memory_search / read 取。
 */
/** 目录最多展示的行数（超出按「全局优先 + 项目轮转」丢弃，末尾给剩余条数）。
 *  实测：本机 200+ 条按项目分组后为 71 行 / 5.1 KB / ≈1.9k token，远低于
 *  1 万 token 预算，所以预算不构成瓶颈——真正的瓶颈是「组内只展开头部」，
 *  那是分层可见性设计，不是为省 token 截断。 */
export const MAX_CATALOG_LINES = 300;
/** 目录正文的字节上限（UTF-8，约 20 KB ≈ 7.4k token）。 */
export const MAX_CATALOG_BYTES = 20480;
/** 单行摘要的字符上限（超出截断，避免一条长记忆把整份目录吃掉）。 */
const CATALOG_LINE_CHARS = 30;
/** 项目名在目录里的最大长度（超出截断，防止长仓库名吃掉预算）。 */
const MAX_LABEL_CHARS = 16;
/** 截断一条摘要（按字符，不切坏代理对）。 */
export function truncateEntry(line, limit = CATALOG_LINE_CHARS) {
    const chars = [...line];
    return chars.length <= limit ? line : chars.slice(0, limit).join('') + '…';
}
/**
 * 目录里的展示优先级：全局偏好最先，其次反馈，最后项目层。
 *
 * 为什么必须排：目录是硬截断的，谁排后面谁就看不见。全局偏好跨项目生效，
 * 不该被任何一个项目的条目挤掉——所以它们整体优先占预算。
 */
function catalogRank(name) {
    if (name === 'user.md')
        return 0;
    if (name === 'feedback.md')
        return 1;
    if (name.startsWith('projects/'))
        return 2;
    return 3;
}
/** 项目层文件名在目录里的单字标记。 */
function fileMark(file) {
    if (file === 'decisions.md')
        return '决';
    if (file === 'pitfalls.md')
        return '坑';
    return '文';
}
/**
 * 一行的前缀：`u` / `f` / `<项目名>/决|坑`。
 *
 * 全路径前缀平均 29.3 字节、占整行 29%——压缩后（约 13 字节）同一份预算能
 * 多装约 16% 的条目。项目名缺失时退回 id 前 6 位（老数据没记录过名字）。
 */
export function catalogPrefix(name, projectNames = {}) {
    if (name === 'user.md')
        return 'u';
    if (name === 'feedback.md')
        return 'f';
    const parts = name.split('/');
    if (parts.length === 3 && parts[0] === 'projects') {
        const id = parts[1] ?? '';
        const label = (projectNames[id] ?? id.slice(0, 6)).slice(0, MAX_LABEL_CHARS);
        return label + '/' + fileMark(parts[2] ?? '');
    }
    return name;
}
/**
 * 展平条目并决定顺序：全局层整体优先，项目层按「每个文件轮流出一条」。
 *
 * 轮转而不是顺序：项目层条目数会随使用不断增长，顺序排列时后出现的项目
 * 永远排在截断线外（实测 21 条整段消失）。轮转让每个文件至少露头一次。
 */
function orderEntries(entries) {
    const sorted = [...entries].sort((a, b) => catalogRank(a.name) - catalogRank(b.name) || a.name.localeCompare(b.name));
    const globals = sorted.filter((entry) => catalogRank(entry.name) < 2);
    const projects = sorted.filter((entry) => catalogRank(entry.name) >= 2);
    const out = [];
    for (const entry of globals)
        for (const line of entry.lines)
            out.push({ name: entry.name, line });
    const depth = projects.reduce((max, entry) => Math.max(max, entry.lines.length), 0);
    for (let i = 0; i < depth; i += 1) {
        for (const entry of projects) {
            const line = entry.lines[i];
            if (line !== undefined)
                out.push({ name: entry.name, line });
        }
    }
    return out;
}
/**
 * 把「文件 → 条目行」渲染成目录正文。
 *
 * @param entries - 每个文件的条目行（顺序无关，本函数按「全局优先 + 项目轮转」重排）。
 * @param projectNames - 项目 id → 可读名（缺失时退回 id 前 6 位）。
 * @returns 一行一条的目录；空库返回空串（调用方给「还没有记忆」的说明）。
 */
/** 尾注里最多点名几份文件（再多就没有指向性，只剩噪音）。 */
const MAX_OVERFLOW_FILES = 4;
/**
 * 超预算尾注：给出**每份文件**还剩多少条，让 agent 知道该去 read 哪一份。
 *
 * 旧的单一「另有 N 条」只给总数——agent 只能 agent_memory_list 拉全量（一次
 * 多付几 KB 且仍然只是摘要）。实测本机平铺 199 条只显示 100 行、99 条不可见，
 * 而 list 全量的成本正好抵消了「正文零常驻」的设计收益。
 */
function overflowNote(dropped, droppedByFile, projectNames) {
    const parts = [...droppedByFile.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_OVERFLOW_FILES)
        .map(([name, count]) => catalogPrefix(name, projectNames) + ' ' + count);
    const more = droppedByFile.size > MAX_OVERFLOW_FILES ? ' 等' : '';
    return '（另有 ' + dropped + ' 条未展开：' + parts.join('、') + more + '，用 agent_memory_list 看全量）';
}
/** 组内短前缀：项目名已在分组标题上，行里不再重复（每行省约 13 字节）。 */
function shortPrefixOf(name) {
    if (name === 'user.md')
        return 'u';
    if (name === 'feedback.md')
        return 'f';
    return fileMark(name.split('/').pop() ?? '');
}
/** 分组标签：全局层统一「全局」，项目层用可读项目名。 */
function groupLabelOf(name, projectNames) {
    const parts = name.split('/');
    if (parts.length !== 3 || parts[0] !== 'projects')
        return '全局';
    const id = parts[1] ?? '';
    return (projectNames[id] ?? id.slice(0, 6)).slice(0, MAX_LABEL_CHARS);
}
/** 按「全局 / 项目」分组；组内顺序保持文件与条目原序。 */
function groupEntries(entries, projectNames, recency) {
    const map = new Map();
    for (const entry of entries) {
        const label = groupLabelOf(entry.name, projectNames);
        const group = map.get(label) ?? { label, isProject: entry.name.startsWith('projects/'), recent: 0, items: [] };
        for (const line of entry.lines)
            group.items.push({ name: entry.name, mark: shortPrefixOf(entry.name), line });
        group.recent = Math.max(group.recent, recency[entry.name] ?? 0);
        map.set(label, group);
    }
    // 全局组永远在前；项目组按条目数降序（条目多的项目先露头）
    // 全局组永远在前；项目组按「最近写入」降序（拿不到 cwd 时，最近写过的项目
    // 大概率就是当前在干的那个），平手再按条目数降序。
    return [...map.values()].sort((a, b) => Number(a.isProject) - Number(b.isProject) ||
        b.recent - a.recent ||
        b.items.length - a.items.length ||
        a.label.localeCompare(b.label));
}
/** 最近活跃项目组默认展开的条数（其余项目只展开前几条）。 */
const RECENT_GROUP_VISIBLE = 12;
/** 非活跃项目组默认展开的条数——够看出这个项目有哪些类型的记忆，不占目录主体。 */
const GROUP_VISIBLE = 4;
function dropItem(state, name) {
    state.dropped += 1;
    state.droppedByFile.set(name, (state.droppedByFile.get(name) ?? 0) + 1);
}
/** 渲染一个分组：标题 + 展开的条目 + 折叠说明；预算不够时整组进丢弃计数。 */
function renderGroup(group, cap, state) {
    const heading = '## ' + group.label + '（' + group.items.length + ' 条）';
    const headingSize = Buffer.byteLength(heading, 'utf8') + 1;
    // 标题放不下时整组丢弃：半个分组比没有分组更容易误读。
    if (state.rows.length >= MAX_CATALOG_LINES || state.bytes + headingSize > MAX_CATALOG_BYTES) {
        for (const item of group.items)
            dropItem(state, item.name);
        return;
    }
    state.rows.push(heading);
    state.bytes += headingSize;
    const visible = group.items.slice(0, cap);
    for (const item of visible) {
        const row = item.mark + ' · ' + truncateEntry(item.line);
        const size = Buffer.byteLength(row, 'utf8') + 1;
        if (state.rows.length >= MAX_CATALOG_LINES || state.bytes + size > MAX_CATALOG_BYTES) {
            dropItem(state, item.name);
            continue;
        }
        state.rows.push(row);
        state.bytes += size;
    }
    const hidden = group.items.length - visible.length;
    if (hidden > 0)
        state.rows.push('…另有 ' + hidden + ' 条');
}
export function renderCatalog(entries, projectNames = {}, options = {}) {
    const state = { rows: [], bytes: 0, dropped: 0, droppedByFile: new Map() };
    let projectSeen = 0;
    for (const group of groupEntries(entries, projectNames, options.recency ?? {})) {
        // 分层展示：全局层全量（跨项目通用、最该被想起），项目层只展开头部——
        // 最近活跃项目 12 条、其余 4 条，让「最近在干的那个项目」自然浮到最前。
        const cap = group.isProject ? (projectSeen === 0 ? RECENT_GROUP_VISIBLE : GROUP_VISIBLE) : Number.POSITIVE_INFINITY;
        renderGroup(group, cap, state);
        if (group.isProject)
            projectSeen += 1;
    }
    if (state.dropped > 0)
        state.rows.push(overflowNote(state.dropped, state.droppedByFile, projectNames));
    return state.rows.join('\n');
}
