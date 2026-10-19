// ── 设置页注册（官方 slots 扩展点）───────────────────────────────────────
// 两处注册，写入的是**加法型** seat：
//  1. settings.plugins.tab（list）：id / order / 惰性 label —— DSH < 0.1.7 与
//     「设置 → 内置插件」分区仍走它；
//  2. plugins.bundle.config（keyed）：key = 组合包 npm 包名（= package.json name），
//     只在 view: 'page' 时渲染，供 >= 0.1.7 的插件管理器在组合包详情页复用同一视图。
// 两处共用 MdrSettingsView（渲染 / 关于 双 tab）。
//
// 片段编译模式：本文件与其余 client 片段一样是 **script 模式**（无 import/export）。
// 重名靠命名消除（不能靠模块隔离）；设置页样式由 parts/styles-settings.ts 提供，
// 经 parts/styles.ts 聚合进主样式表（本文件不再单独注入，避免同一份 CSS 进两次）。

/** 页签 id：必须全局唯一 —— 复用宿主已发出的 id 会**替换**对方页签（静默故障）。 */
const MD_RENDER_SETTINGS_TAB_ID = 'md-render-settings'
/** 页签顺序（合并前三插件分别为 90 / 92 / 95，合一后取最前者）。 */
const MD_RENDER_SETTINGS_TAB_ORDER = 90

/** 官方 slots 扩展点（设置页注册）的最小契约：同时覆盖 list 与 keyed 两种 slot 形态。 */
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

/** 组合包详情页 slot 宿主传入的视图参数（官方契约：view: 'summary' | 'page'）。 */
interface MdRenderBundleConfigProps {
  view?: string
}

/** DSH >= 0.1.7 插件管理器的组合包详情页配置 slot（keyed）。 */
const MD_RENDER_BUNDLE_CONFIG_SLOT = 'plugins.bundle.config'

/** keyed slot 的 key：必须是本组合包的 npm 包名（宿主按包名派发），与 package.json 一致。 */
const MD_RENDER_PACKAGE_NAME = 'dsh-md-render'

/**
 * 组合包详情页配置视图：summary 返回 null（列表页不占位），page / 缺省复用设置页视图。
 */
function mdRenderBundleConfigView(props?: MdRenderBundleConfigProps): unknown {
  if (props !== undefined && props !== null && props.view === 'summary') return null
  return MdrSettingsView()
}

/** 拉取当前生效配置（GET）；失败交 onError（kind 供提示区分）。 */
function mdRenderLoadConfig(onValue: (value: MdRenderSettingsConfig) => void, onError: (kind: string) => void): void {
  fetch(CONFIG_API_URL)
    .then((res) => {
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status })
      return res.json()
    })
    .then((body: { ok?: boolean; value?: MdRenderSettingsConfig }) => {
      if (body === null || body.ok !== true) throw new Error('bad config response')
      onValue(body.value ?? {})
    })
    .catch((err: { status?: number }) => onError(typeof err?.status === 'number' ? 'http:' + err.status : 'network'))
}
/** 保存配置（PUT）：发全量草稿（host 半按段合并）；成功后立即应用并点亮「已保存」。 */
function mdRenderSaveConfig(draft: MdRenderSettingsConfig, onSaved: () => void, onError: (kind: string) => void): void {
  fetch(CONFIG_API_URL, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
    .then((res) => res.json())
    .then((body: { ok?: boolean }) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
      setRenderOptions(draft)
      onSaved()
    })
    .catch(() => onError('save'))
}
/**
 * 注册设置页签。三处刻意的写法：
 *  · 设置页样式随主样式表注入（parts/styles.ts 聚合 STYLES_SETTINGS），这里**不再**重复注入；
 *  · `ctx.get('slots', false)`：必须传 strict=false —— 服务提供者 fiber 尚未 active
 *    （首屏）时 strict 取法返回 undefined，页签会消失到下次 HMR；
 *  · 服务缺失（精简上下文 / 老宿主）时静默跳过：设置页是增强，不能拖垮整个 client。
 */
function attachSettingsTab(ctx: MdRenderSettingsCtx): void {
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
        MdrSettingsView,
      ),
    )
    // 字面量（不用常量）：静态断言从**产物**里抽取 inject('…') 的字面量做白名单校验。
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
