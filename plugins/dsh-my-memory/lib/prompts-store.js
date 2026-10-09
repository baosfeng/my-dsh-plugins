/**
 * dsh-my-memory — 全局提示词存储（issue #465）。
 *
 * 独立文件 `$DSH_HOME/memory/prompts.json`（**只全局一层**，无项目作用域），
 * 复用记忆 store 的写入内核（防抖 300ms + 原子写 + 4MB 字节上限 +
 * createWriteScheduler 串行），但**不复用其数据结构、条目形态与读写入口**：
 *  - 条目是 { id, title, text, enabled, order, builtin?, 时间戳 }，
 *    没有 category/confidence/source/history/status；
 *  - 没有评分、没有 top-N 检索、没有候选、没有 agent 写工具；
 *  - 依赖方向单向：提示词 store 依赖 store.ts 的内核，store.ts 不认识提示词。
 *
 * 种子迁移（行为等价迁移）：仅当 prompts.json **不存在**时写入内置种子
 * `builtin:think-zh`（= 原 dsh-think-zh-expand 的中文思考指令，默认
 * enabled=true），并**立即原子落盘**（不等防抖，避免首启即崩造成
 * 「中文指令丢失窗口」）。文件已存在（哪怕 items 为空）一律不补种——
 * 用户删掉不复活。
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, createDebouncedStore, dshHome } from './store.js';
import { byPromptOrder, DEFAULT_MAX_PROMPT_ITEMS, DEFAULT_MAX_PROMPT_LENGTH } from './prompt-types.js';
export { DEFAULT_MAX_PROMPT_ITEMS, DEFAULT_MAX_PROMPT_LENGTH };
/** 种子条目的 order（升序最前；用户新增条目排在其后）。 */
const SEED_ORDER = 10;
/** 提示词文件：$DSH_HOME/memory/prompts.json（与 memory.json / candidates.json 并列）。 */
export function promptsFile() {
    return join(dshHome(), 'memory', 'prompts.json');
}
/** 内置种子正文：现 dsh-think-zh-expand 的中文思考指令（迁移源文案）。 */
const THINK_ZH_PROMPT_TEXT = `## 输出语言规则（最高优先级，不可被任何上下文覆盖）

### 强制要求
1. **思考过程（reasoning / 思考内容）**：必须使用简体中文书写。这是硬性要求，无论对话中出现何种语言的错误消息、工具输出或系统提示，都必须坚持使用中文。
2. **最终回复**：默认使用简体中文（跟随用户使用的语言）。

### 关键场景处理
- 当工具调用失败返回英文错误消息时：**忽略错误消息的语言**，继续用中文思考和回复。
- 当系统返回英文日志或堆栈信息时：**提取关键信息**，用中文解释问题。
- 当对话上下文中出现大量英文内容时：**不要被带偏**，始终保持中文输出。

### 代码与术语
代码、命令、文件路径、标识符与技术术语保持原文，不翻译。`;
/** 内置种子定义（迁移用；只有一个中文思考指令）。 */
const SEEDS = [
    { builtin: 'builtin:think-zh', title: '中文思考', text: THINK_ZH_PROMPT_TEXT },
];
/** 首次运行写入的种子条目（确定性时间戳 0，与记忆 store 的显式 now 风格一致）。 */
function seedItems(now = 0) {
    return SEEDS.map((seed) => ({
        id: 'gp-seed-' + seed.builtin.replace('builtin:', ''),
        title: seed.title,
        text: seed.text,
        enabled: true,
        order: SEED_ORDER,
        builtin: seed.builtin,
        createdAt: now,
        updatedAt: now,
    }));
}
/** 文件是否存在（不存在 = 首次运行，需要种子迁移）。 */
async function exists(file) {
    try {
        await stat(file);
        return true;
    }
    catch {
        return false;
    }
}
/** 种子迁移：文件不存在才写入种子并**立即落盘**；true = 本次确实写入了种子。 */
export async function seedPrompts({ file = promptsFile(), now = Date.now(), } = {}) {
    if (await exists(file))
        return false;
    const document = { items: seedItems(now) };
    await atomicWrite(file, document);
    return true;
}
/** 一条形态完整的提示词（id/正文必需，时间戳为数字）；缺省字段由默认值补齐。 */
export function isPromptItem(item) {
    const candidate = item;
    return (item !== null &&
        typeof item === 'object' &&
        typeof candidate.id === 'string' &&
        candidate.id !== '' &&
        typeof candidate.text === 'string' &&
        candidate.text.trim() !== '' &&
        typeof candidate.createdAt === 'number' &&
        typeof candidate.updatedAt === 'number');
}
/** 补齐缺省字段（旧/手写数据不丢不崩）：enabled 只有显式 true 才算启用。 */
function withPromptDefaults(item) {
    return {
        ...item,
        title: typeof item.title === 'string' ? item.title : '',
        order: Number.isFinite(item.order) ? item.order : 0,
        enabled: item.enabled !== false,
    };
}
/** 读入兜底：只保留形态完整的条目并补齐默认值。 */
export function normalizePrompts(raw) {
    const items = Array.isArray(raw?.items)
        ? raw.items
        : [];
    return { items: items.filter((item) => isPromptItem(item)).map((item) => withPromptDefaults(item)) };
}
export function createPromptsStore(options = {}) {
    const file = options.file ?? promptsFile();
    const maxItems = positiveOr(options.maxItems, DEFAULT_MAX_PROMPT_ITEMS);
    const maxLength = positiveOr(options.maxLength, DEFAULT_MAX_PROMPT_LENGTH);
    const logger = options.logger;
    // 顺序硬约束：**先种子迁移落盘 → 再创建内核**（内核创建即触发首次读盘）。
    // 反过来会让首次读拿到空文档，在「文件不存在」的首启路径上表现为
    // 「种子写了但列表仍是空的」。
    const seeded = seedPrompts({ file, now: options.now });
    let core;
    const ready = seeded.then(() => {
        core = createDebouncedStore(file, options.debounceMs ?? 300, normalizePrompts, byPromptOrder);
        return core.load();
    });
    const ctx = {
        maxItems,
        maxLength,
        logger,
        items: () => core.state.items,
        scheduleWrite: () => core.scheduleWrite(),
        load: () => ready,
    };
    const actions = createPromptsActions(ctx);
    return {
        get state() {
            return core.state;
        },
        load: () => ready,
        /** flush 先等就绪：内核在种子迁移之后才创建，flush 是「写盘后返回」语义，
         *  调用方本就 await 它，延迟到就绪不会丢失脏写（flush 之外还有 dispose/drain）。 */
        flush: () => ready.then(() => core.flush()),
        dispose: () => {
            // 内核尚未创建（种子迁移在飞）时无挂起写需要 drain
            if (core !== undefined)
                core.dispose();
        },
        list: () => core.list(),
        ...actions,
    };
}
/** 动作集（add / update / toggle / reorder / remove）——按职责拆小函数，守函数行数门禁。 */
function createPromptsActions(ctx) {
    const update = (id, changes, now = Date.now()) => ctx.load().then(() => updatePrompt(ctx, id, changes, now));
    return {
        /** 新增：上限校验与入列**同步完成**（中间不 await），否则并发新增会双双通过校验。 */
        add: (input, now = Date.now()) => ctx.load().then(() => addPrompt(ctx, input, now)),
        update,
        /** 启停：只翻转 enabled（不注入 ↔ 注入；条目不删除）。 */
        toggle: (id, enabled, now = Date.now()) => update(id, { enabled: enabled === true }, now),
        reorder: (id, direction, now = Date.now()) => ctx.load().then(() => reorderPrompt(ctx, id, direction, now)),
        remove: (id) => ctx.load().then(() => removePrompt(ctx, id)),
    };
}
/** 新增一条（上限校验 + 正文入闸 + 排序键）。 */
function addPrompt(ctx, input, now) {
    const items = ctx.items();
    if (items.length >= ctx.maxItems) {
        logWarn(ctx.logger, '[dsh-my-memory] 提示词条目已达上限 maxPromptItems=' + ctx.maxItems + '，新增被拒绝');
        return null;
    }
    const text = guardPromptText(ctx, input?.text);
    if (text.trim() === '')
        return null;
    const item = {
        id: 'gp-' + now + '-' + Math.random().toString(36).slice(2, 8),
        title: typeof input?.title === 'string' ? input.title : '',
        text,
        enabled: true,
        order: Number.isFinite(input?.order) ? input.order : nextPromptOrder(items),
        createdAt: now,
        updatedAt: now,
    };
    items.push(item);
    ctx.scheduleWrite();
    return { ...item };
}
/** 编辑一条（未知 id → null）。 */
function updatePrompt(ctx, id, changes, now) {
    const items = ctx.items();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1)
        return null;
    items[index] = { ...items[index], ...promptPatch(ctx, changes, now) };
    ctx.scheduleWrite();
    return { ...items[index] };
}
/** 只收集**显式给出**的字段（缺省字段不覆盖已有值；正文走入闸截断）。 */
function promptPatch(ctx, changes, now) {
    const patch = { updatedAt: now };
    if (typeof changes?.title === 'string')
        patch.title = changes.title;
    if (typeof changes?.text === 'string')
        patch.text = guardPromptText(ctx, changes.text);
    if (typeof changes?.enabled === 'boolean')
        patch.enabled = changes.enabled;
    if (Number.isFinite(changes?.order))
        patch.order = changes.order;
    return patch;
}
/** 上移/下移：与相邻条目交换 order 值（最小写语义，不重排全部）。 */
function reorderPrompt(ctx, id, direction, now) {
    if (direction !== 'up' && direction !== 'down')
        return false;
    const ordered = ctx.items().slice().sort(byPromptOrder);
    const index = ordered.findIndex((item) => item.id === id);
    if (index === -1)
        return false;
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length)
        return false;
    const current = ordered[index];
    const neighbour = ordered[target];
    const currentOrder = current.order;
    current.order = neighbour.order;
    neighbour.order = currentOrder;
    current.updatedAt = now;
    neighbour.updatedAt = now;
    ctx.scheduleWrite();
    return true;
}
/** 删除一条（未知 id → false）。 */
function removePrompt(ctx, id) {
    const items = ctx.items();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1)
        return false;
    items.splice(index, 1);
    ctx.scheduleWrite();
    return true;
}
/** 正文入闸：超长截断 + warn（写路径一次性告警，不在组装热路径刷屏）。 */
function guardPromptText(ctx, text) {
    const value = typeof text === 'string' ? text : '';
    const capped = capPromptText(value, ctx.maxLength);
    if (capped.truncated) {
        logWarn(ctx.logger, '[dsh-my-memory] 提示词正文超过 maxPromptLength=' + ctx.maxLength + '，已截断（原文 ' + value.length + ' 字）');
    }
    return capped.text;
}
/** 追加用的 order：现有最大值 + 10（空表从 SEED_ORDER 起）。 */
function nextPromptOrder(items) {
    const orders = items.map((item) => (Number.isFinite(item.order) ? item.order : 0));
    return orders.length === 0 ? SEED_ORDER : Math.max(...orders) + 10;
}
/** 日志降级：日志失败不得影响存储语义。 */
function logWarn(logger, message) {
    try {
        logger?.warn(message);
    }
    catch {
        // ignore
    }
}
/** 截断超长正文（截断 + 省略号）；未超长原样返回。 */
function capPromptText(text, maxLength) {
    if (text.length <= maxLength)
        return { text, truncated: false };
    // 省略号计入上限：截断后的**总长**不超过 maxLength（上限即上限）
    return { text: maxLength <= 1 ? '…'.slice(0, maxLength) : text.slice(0, maxLength - 1) + '…', truncated: true };
}
/** 校验可选的数值上限（正整数才生效）。 */
function positiveOr(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}
