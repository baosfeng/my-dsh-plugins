/** 共享样式注入（dsh-shared/client-parts/style-tag.part.js，构建期拼接）。 */
declare function installStyles(
  ctx: { effect: (fn: () => void | (() => void), label?: string) => void },
  attr: string,
  css: string,
  label: string,
): void

// **刻意保持零 inject**（R1 实测，见 lang-source.ts 头部 / 报告）：
// dsh-md-render 是纯增强插件，硬 inject 在服务缺失时会让 apply **根本不执行** ——
// 整个 client 半失效（样式 / 设置页 / 全部注入点一起没）。会话事件流（围栏语言索引的
// 主源）改用 ctx.get('sessions', false) 惰性取：服务在则取到、服务缺则 undefined 不抛、
// 服务晚于 apply 提供也照样取到（cordis 4 的 ReflectService.get 契约即
// "without the inject requirement"）。inject:{optional:[...]} 在 cordis 4.0.4 不被支持
// （实测 apply 不执行），故也不用。
exports.inject = []

exports.apply = function apply(ctx: {
  effect: (fn: () => void | (() => void), label?: string) => void
  get?: (name: string, strict?: boolean) => unknown
}): void {
  // 增强功能开关：默认全开；真实配置异步经 GET /md-render/api/config 拉取应用
  // （client 端不能访问 ctx.config——Cordis inject 限制，访问抛
  // "cannot get property without inject"，导致 client failed to apply）。
  setRenderOptions()
  initConfigFromServer()

  // 样式注入走共享实现：与 dsh-shared 的其它消费者同一份「无条件最先注入 +
  // 随 fiber teardown 卸载」逻辑（style-tag.part.js）。位置仍在最前、不进任何
  // 早退分支（dsh-file-activity 踩坑：挂在服务判空之后，HMR / 服务缺省时样式会丢）。
  installStyles(ctx, 'data-dsh-md-render', STYLES, 'dsh-md-render: styles')

  // 三个渲染注入点共用**一个** MutationObserver（scanner.ts 按语言分流）。
  // 传 ctx 进去：scanner 每批扫描前用它按需刷新围栏语言索引（lang-source.ts）。
  // 需求 4 的「刷新后仍记得」：启动时恢复上次的「渲染为…」覆盖（不可用 -> 空表，退回自动判定）。
  restoreFenceForces()

  ctx.effect(() => installScanner(ctx), 'dsh-md-render: scanner')

  // 设置页 tab（官方 slots 扩展点，单 tab 三分组）。
  attachSettingsTab(ctx)
}
