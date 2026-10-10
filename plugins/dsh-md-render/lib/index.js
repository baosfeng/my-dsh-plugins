/**
 * dsh-md-render — host half（合并 think-zh-expand + mermaid-render，issue #463）。
 *
 * 合并后 host 半提供四件事：
 *  1. **配置读写路由** `/md-render/api/config`（GET/PUT，唯一一条配置路径）：
 *     命名空间化 config（markdown/thinking/mermaid）+ 旧扁平键读兼容；
 *  2. **静态资源路由** `/md-render/assets`：mermaid 引擎（不内联进 bundle）；
 *  3. **system-prompt 注入**：仅 mermaid 能力声明（`injectPrompt` 开关）。
 *     中文思考指令不在此注册 —— 由 dsh-my-memory 的「全局提示词」提供。
 *  4. **围栏语言索引**（issue #466）：订阅 `session/event` 解析消息 markdown 原文，
 *     建「块内容哈希 → 语言」有界索引；client 半在 DOM 认不出语言时经
 *     `GET /md-render/api/langs` 查表（真实宿主 banner 只给本地化标签「代码块」）。
 *
 * 渲染本体全部在 client 半（lib/client.js）。配置保存写 profile patch 文件
 * （复用 dsh-shared），DSH 的 watchUserPatches 热重载后 client 重新 apply
 * （保存即生效，无需重启）。
 *
 * 本文件编译为 lib/index.js（产物必须提交，CI 只跑产物、不跑构建）。
 */
import { createConfigState, mergeConfig, persistConfig } from './config.js';
import { createLangIndex } from './lang-index.js';
import { createPromptSection } from './prompt.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerConfigRoutes } from './routes/config.js';
import { recordSessionEvent } from './session-text.js';
export const name = 'dsh-md-render';
/**
 * 服务依赖：webServer（路由）+ systemPrompt（能力声明）。
 *
 * `webServer` **必须**声明：cordis 4 的 service 守卫在 `ctx.webServer` 的 **get 阶段**
 * 就抛 `cannot get property "webServer" without inject`，可选链挡不住。
 * cordis 4 的 inject 没有 required/optional 语义；声明后在没有 webServer 的 profile
 * （如 tui）里该 fiber 保持 inactive —— 这正是期望。
 */
export const inject = ['webServer', 'systemPrompt'];
export function apply(ctx, config) {
    // 应用层 config 优先；旧扁平键读兼容在 createConfigState 内（用户 profile 已落盘）。
    const state = createConfigState(config);
    // 围栏语言索引：消息 markdown 原文 → 「块内容哈希 → 语言」（有界、不落盘）。
    const langIndex = sharedLangIndex();
    attachSessionIndex(ctx, langIndex);
    // system-prompt：只注册 mermaid 能力声明（先撤后注册，同值不惊动宿主）。
    const syncSection = createSectionSync(ctx);
    syncSection(state.mermaid.injectPrompt);
    // 配置保存：持久化（合并行内已有键）+ 更新内存 + section 热同步。
    registerConfigRoutes(ctx, state, async (patch) => {
        const next = mergeConfig(state, patch);
        await persistConfig(next);
        Object.assign(state.markdown, next.markdown);
        Object.assign(state.thinking, next.thinking);
        Object.assign(state.mermaid, next.mermaid);
        syncSection(next.mermaid.injectPrompt);
        ctx.logger?.info(`[dsh-md-render] 配置已保存（变更段=${Object.keys(patch).join(',')}）`);
    }, langIndex);
    // 静态资源：mermaid 引擎（按需 fetch，不内联）。
    registerAssetRoutes(ctx);
    ctx.logger?.info(state.mermaid.injectPrompt
        ? '[dsh-md-render] 已启用（markdown 增强 + 思考展开 + mermaid 渲染 + 能力声明注入）'
        : '[dsh-md-render] 已启用（markdown 增强 + 思考展开 + mermaid 渲染；能力声明注入已关闭）');
}
/** 进程内语言索引单例：profile patch 热重载会重新 apply，索引必须跨 re-apply 保留。 */
let langIndexSingleton = null;
/** 取语言索引（首次调用时创建；有界、零磁盘 IO）。 */
function sharedLangIndex() {
    langIndexSingleton ??= createLangIndex();
    return langIndexSingleton;
}
/** 已注册的会话监听（按常驻 root 去重，WeakMap 不阻止 GC）。 */
const sessionListeners = new WeakMap();
/**
 * 订阅 `session/event` 建语言索引。**注册到常驻 root + `{ global: true }`**：
 * profile 插件的 fiber 会被 loader 回收，注册在插件自身 ctx 上的监听器会静默消失
 * （事件 0 触发、无任何报错，见 docs/踩坑/README.md）；重复 apply 先撤后注册不叠加。
 * 精简上下文（老宿主 / 测试桩）没有 `on` → 直接跳过（索引为空，client 保持官方默认）。
 */
function attachSessionIndex(ctx, index) {
    const listenCtx = ctx.root ?? ctx;
    const on = listenCtx.on;
    if (typeof on !== 'function')
        return;
    sessionListeners.get(listenCtx)?.();
    sessionListeners.set(listenCtx, on('session/event', (_session, event) => void recordSessionEvent(index, event), {
        global: true,
    }));
}
/**
 * 注册/撤销 systemPrompt section：可重入 + **幂等**（保存后调用即热生效）。
 * 幂等很重要：重复注册同名 section 宿主会抛错，而无谓的撤销+重注册会让
 * 「保存一个与原值相同的配置」也惊动宿主（也可能丢掉其它插件的顺序假设）。
 */
function createSectionSync(ctx) {
    let dispose = null;
    let current = null;
    return (inject) => {
        if (current === inject)
            return;
        if (dispose !== null) {
            dispose();
            dispose = null;
        }
        current = inject;
        const section = createPromptSection(inject);
        if (section === null)
            return;
        dispose = ctx.systemPrompt?.section(section) ?? null;
    };
}
