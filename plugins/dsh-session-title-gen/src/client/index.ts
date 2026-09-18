// ── dsh-session-title-gen — client 半入口（设置页签，issue #385）──────────
// 本插件是纯 server 形态（标题生成在主进程完成），client 半只承担一件事：
// 在「设置 → 插件」注册「会话标题生成」设置页，让 8 项配置可可视化编辑
// （此前只能手写 cordis.patch.yml）。
//
// 视图、文案与注册逻辑在 settings.ts / strings.ts（构建期由 build.mjs 注入同一
// factory 作用域；本文件只做入口）。产物 lib/client.js 必须提交（CI 只跑
// node --check + 测试，不跑构建）。

/** client 端 Context 的最小契约（cordis Context + slots 服务）。 */
interface SessionTitleClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  get?(name: string, strict?: boolean): unknown
  slots?: unknown
}

// 注：编译产物内联进 factory 作用域后，module.exports 已在模板中声明。
// 此处直接使用 module.exports（模板顶部已声明 var module = { exports: {} }）。
const _exports = module.exports as Record<string, unknown>
_exports.inject = ['slots']

_exports.apply = function apply(ctx: SessionTitleClientContext): void {
  // 设置页签（issue #385）：注册「设置 → 插件 → 会话标题生成」。
  // 拿不到 slots（精简上下文 / 老宿主）时静默降级，见 settings.ts 的 attachSettingsTab。
  attachSettingsTab(ctx)
}
