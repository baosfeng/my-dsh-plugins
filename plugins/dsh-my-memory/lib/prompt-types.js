/**
 * dsh-my-memory — 全局提示词（global prompt，issue #465）类型定义。
 *
 * 与记忆条目**结构上互不兼容**（不共享任何字段）：提示词只有
 * title / text / enabled / order / builtin + 时间戳，没有分类、置信度、
 * 来源、演进历史、状态等记忆语义字段——两个 store 之间无法互相读取，
 * 这是「存储隔离」的结构性防线。
 */
/** 注入条数上限的默认值（安全阀；store 与注入模块共用同一常量，避免两处漂移）。 */
export const DEFAULT_MAX_PROMPT_ITEMS = 20;
/** 单条正文上限的默认值（字符，超出截断 + warn）。 */
export const DEFAULT_MAX_PROMPT_LENGTH = 1000;
/** 提示词排序：order 升序，同 order 按 createdAt 升序（再按 id 保证稳定）。
 *  放在类型模块里，使注入模块不必依赖存储模块（provider 内零磁盘 IO 的结构保证）。 */
export function byPromptOrder(a, b) {
    if (a.order !== b.order)
        return a.order - b.order;
    if (a.createdAt !== b.createdAt)
        return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
