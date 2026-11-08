/**
 * dsh-my-memory — system-prompt injection (TypeScript 源码)。
 *
 * Registers one section (`dsh-my-memory`, order -95 — before the deployment
 * persona at 0 and before dsh-think-zh's -90) whose text is a provider
 * evaluated at every prompt assembly: it reads the GLOBAL memory cache and
 * renders the strongest `maxItems` entries picked by the issue #78 smart
 * scoring (relevance to the current session + recency + confidence — NOT a
 * plain top-N by newest), each summarized to `maxDescLength` characters —
 * the summary prefers the full first sentence and never cuts mid-sentence
 * (issue #105). An empty memory renders an empty section, which the prompt
 * renderer drops — so the injection costs nothing until the user actually
 * stores memories. Because the text is re-evaluated per assembly, a memory
 * saved mid-session is visible to the agent on the very next turn without a
 * restart.
 */
import { DEFAULT_MAX_DESC_LENGTH, summarizeDesc } from './memory-text.js';
import { DEFAULT_PINNED_MAX, decayConfidence, pickForInjection } from './memory-scoring.js';
/** Default cap on how many global memories are injected. */
const DEFAULT_MAX_ITEMS = 5;
/**
 * Truncate one desc to the length cap, preferring the full first sentence
 * (semantic truncation — never cuts mid-sentence when a sentence boundary
 * fits; issue #105). Kept as the historical export name for callers/tests;
 * the implementation now lives in memory-text.js.
 */
export function truncateDesc(desc, maxLength) {
    return summarizeDesc(desc, maxLength);
}
/** Render the injected section text for the picked global memories.
 *
 *  issue #518：恒定条目（pinned）单列一节排在最前——agent 读到的第一件事
 *  就是「必须每轮生效」的硬约束；没有恒定条目时保持历史输出形状不变。
 */
export function renderMemorySection({ pinned, scored }, { maxItems, maxDescLength }) {
    const picked = scored.slice(0, maxItems);
    const pinnedLines = pinned.map((item) => `- ${truncateDesc(item.desc, maxDescLength)}`);
    const lines = picked.map((item) => `- ${truncateDesc(item.desc, maxDescLength)}`);
    if (pinnedLines.length === 0 && lines.length === 0)
        return '';
    const head = `## 用户记忆（全局）
以下是你需要始终携带的用户长期偏好与关键约定（来自 dsh-my-memory 插件）：`;
    if (pinnedLines.length === 0)
        return `${head}\n${lines.join('\n')}`;
    const pinnedBlock = `### 恒定（每轮必生效）\n${pinnedLines.join('\n')}`;
    return lines.length === 0 ? `${head}\n${pinnedBlock}` : `${head}\n${pinnedBlock}\n### 相关记忆\n${lines.join('\n')}`;
}
/** The current-session context handed to the smart picker (keywords only). */
function contextOf() {
    // 未来可扩展：从当前会话标题/首条消息提取关键词（#78 相关性维度）。
    // 现为空的上下文 → 相关性权重不生效，score 退化为 时效性 + 置信度。
    return { keywords: [] };
}
/** 正整数取值（非法/缺省回退 fallback）。 */
function positiveInt(value, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
/** 非负整数（非法/缺省 → undefined，即用 pickForInjection 的默认名额）。 */
function nonNegativeInt(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
/** 注入限额归一化（issue #518 抽出）：把四个配置键的取值逻辑从 section 工厂里
 *  剥离，避免 createMemorySection 的圈复杂度随配置项增长。 */
function limitsOf(config) {
    const decay = positiveInt(config?.decayMs, 0);
    return {
        maxItems: positiveInt(config?.maxItems, DEFAULT_MAX_ITEMS),
        maxDescLength: positiveInt(config?.maxDescLength, DEFAULT_MAX_DESC_LENGTH),
        decayMs: decay > 0 ? decay : undefined,
        pinnedMax: nonNegativeInt(config?.pinnedMaxItems),
    };
}
/** 恒定条目超出名额时告警（绝不静默丢）。 */
function warnPinnedOverflow(config, dropped, pinnedMax) {
    if (dropped <= 0)
        return;
    const cap = pinnedMax ?? DEFAULT_PINNED_MAX;
    config?.logger?.warn(`[dsh-my-memory] 恒定记忆超出注入名额：${dropped} 条未注入（pinnedMaxItems=${cap}），请取消部分条目的恒定或调大配置`);
}
/** Build the system-prompt section registration for a global store. */
export function createMemorySection(globalStore, config) {
    const { maxItems, maxDescLength, decayMs, pinnedMax } = limitsOf(config);
    return {
        name: 'dsh-my-memory',
        order: -95,
        // 记忆正文是用户数据，绝不能被宿主的 {{变量}} 解析器当成模板：
        // 一条含 {{...}} 的记忆曾让整个 prompt 组装抛错、所有回合失败。
        interpolate: false,
        text: () => {
            // issue #78 智能注入：先做长期未用降权（时效性），再按 相关性 +
            // 时效性 + 置信度 评分选 top-N（替代简单按 updatedAt 取最新 N 条）。
            // issue #518：恒定条目走独立通道，不占 maxItems 名额。
            const decayed = decayConfidence(globalStore.list(), Date.now(), decayMs);
            const { picked, pinned, pinnedDropped } = pickForInjection(decayed.items, contextOf(), { maxItems, pinnedMax });
            warnPinnedOverflow(config, pinnedDropped, pinnedMax);
            return renderMemorySection({ pinned, scored: picked }, { maxItems, maxDescLength });
        },
    };
}
