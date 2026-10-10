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

/**
 * 官方 slots 扩展点（设置页注册）的最小契约。
 *
 * options 同时覆盖两种 slot 形态，故除 `name` 外全部可选：
 *  - **list**（`settings.plugins.tab`）：需要 `id`（必填）/ `order` / `label`；
 *  - **keyed**（`plugins.bundle.config`）：只需要 `key`（= 组合包 npm 包名），
 *    传 `id` / `order` 反而非法 —— 类型写成「keyed 形态也必须合法」。
 */
interface MdRenderSettingsSlots {
  inject(name: string, register: () => unknown): unknown
  register(
    options: { name: string; key?: string; id?: string; order?: number; label?: () => string },
    component: (props?: MdRenderBundleConfigProps) => unknown,
  ): unknown
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
    // issue #443（对齐 #460 的落地方式）：DSH >= 0.1.7 的新版插件管理器
    // （client-ui-plugin-manager）把插件配置页放在**组合包详情页**，由它自己声明
    // `plugins.bundle.config`（keyed slot，key = 组合包 npm 包名，只在 view: 'page'
    // 时渲染）。**追加**这一处注册，上面的 `settings.plugins.tab` 一并保留 ——
    // 旧入口在 DSH < 0.1.7 与「设置 → 内置插件」分区仍然有效，替换会让那些版本丢入口。
    // 字面量（不用常量）：静态断言 test/static-assertions.mjs 从**产物**里抽取
    // `inject('…')` 的字面量做白名单校验，变量名抽不出来。
    slots.inject('plugins.bundle.config', () =>
      slots.register(
        {
          name: MD_RENDER_BUNDLE_CONFIG_SLOT,
          key: MD_RENDER_PACKAGE_NAME,
        },
        mdRenderBundleConfigView,
      ),
    )
    return undefined
  }, 'dsh-md-render: settings tab registration')
}

/** DSH >= 0.1.7 插件管理器的组合包详情页配置 slot（keyed）。 */
const MD_RENDER_BUNDLE_CONFIG_SLOT = 'plugins.bundle.config'

/**
 * keyed slot 的 key：必须是本组合包的 npm 包名（宿主按包名派发），
 * 与 package.json 的 `name` 一致 —— test/settings-bundle-config.mjs 会核对两者。
 */
const MD_RENDER_PACKAGE_NAME = 'dsh-md-render'

/** 组合包详情页 slot 宿主传入的视图参数（官方契约：view: 'summary' | 'page'）。 */
interface MdRenderBundleConfigProps {
  view?: string
}

/**
 * 组合包详情页配置视图（issue #443）：
 *  - `view === 'summary'` → 返回 null（摘要/列表页不渲染多余组件，不占位）；
 *  - `'page'` / props 缺省（老宿主不传 props）→ 复用现有设置页视图。
 */
function mdRenderBundleConfigView(props?: MdRenderBundleConfigProps): unknown {
  if (props !== undefined && props !== null && props.view === 'summary') return null
  return mdRenderSettingsView()
}
