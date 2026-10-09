// ── 设置页注册（官方 slots 扩展点，单 tab 三分组）─────────────────────
// 合并前三个插件各注册一个 tab（md-render 90「渲染」/ think-zh 92 / mermaid 95），
// 合并后收敛为**一个** tab「渲染」三分组 —— 一次保存写全量，天然消除「三 tab 各自
// PUT 各自路径」的重复。
//
// 片段的编译模式：本文件与其余片段一样是 **script 模式**（无 import/export）——
// tsc 在 script 模式下让所有 client 片段共享一个检查作用域，跨文件引用天然可见；
// 一旦写 `export {}` 就变成模块、跨文件引用全部不可见（且片段间无法 import，
// 因为产物是构建期拼接的单一 factory 作用域）。重名因此必须靠命名消除，
// 不能靠模块隔离。

/** 官方 slots 扩展点（设置页 tab 注册）的最小契约。 */
interface MdRenderSettingsSlots {
  inject(name: string, register: () => unknown): unknown
  register(options: { name: string; id: string; order: number; label: () => string }, component: () => unknown): unknown
}

/** client 端 ctx 的最小契约（只需要 effect 与 cordis 的 get）。 */
interface MdRenderSettingsCtx {
  effect(callback: () => void | (() => void), label?: string): void
  get?(name: string, strict?: boolean): unknown
}

/**
 * 注册设置页签。三处刻意的写法：
 *  - 样式注入在最前、不进任何早退分支（服务判空 / HMR 时样式会丢）。
 *  - `ctx.get('slots', false)`：**必须传 strict=false** —— cordis 的
 *    `ctx.get(name, strict = true)` 在服务提供者 fiber 尚未 active（首屏）时返回
 *    undefined，页签会消失到下次 HMR；只有 strict=false 才拿得到实例。
 *  - 服务缺失（精简上下文 / 老宿主）时静默跳过：设置页是增强，不能因为拿不到
 *    slots 就让整个 client（含全部渲染能力）挂掉。
 */
function attachSettingsTab(ctx: MdRenderSettingsCtx): void {
  installStyles(ctx, 'data-dsh-md-render-settings', MD_RENDER_SETTINGS_STYLES, 'dsh-md-render: settings styles')
  const slots =
    typeof ctx.get === 'function' ? (ctx.get('slots', false) as MdRenderSettingsSlots | undefined) : undefined
  if (slots === undefined || slots === null) return
  ctx.effect(() => {
    slots.inject('settings.plugins.tab', () =>
      slots.register(
        {
          name: 'settings.plugins.tab',
          id: MD_RENDER_SETTINGS_TAB_ID,
          order: MD_RENDER_SETTINGS_TAB_ORDER,
          // 惰性函数：宿主靠重注册 + 每次求值跟随语言切换（不得写成常量）。
          label: MD_RENDER_STRINGS.tab,
        },
        mdRenderSettingsView,
      ),
    )
    return undefined
  }, 'dsh-md-render: settings tab registration')
}
