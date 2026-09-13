/**
 * dsh-my-context — client half (browser). SOURCE TEMPLATE.
 *
 * 提供侧边栏页签「上下文透镜」（dsh-my-context:context）：
 *  - 概览卡片：累计 token（输入/输出/缓存命中）+ KV 缓存命中率 + 模型；
 *  - 上下文构成条：system/tools/user/inject/assistant/tool 分类占比；
 *  - 请求记录列表：每次请求的 prompt/output token 与缓存命中率；
 *  - 预算设置：每轮/每会话 token 上限 + 提醒/拦截模式（POST /context/api/budget）；
 *  - 预算告警列表：超限记录（提醒/拦截）。
 *
 * 面板可见（visible）时轮询（CONTEXT_POLL_MS），隐藏时暂停（省请求）。
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs 先用
 * tsconfig.client.json 把 src/client/parts/*.ts 编译成 lib/parts/*.js（i18n /
 * panel / overflow / styles 四个片段，均为无 import/export 的纯函数声明文本，
 * 共享 factory 作用域），再经下方 __PART_*__ 占位符（函数式 replaceAll，避免
 * $&/$1 特殊解释）拼接进 factory 作用域，写出 lib/client.js —— 即 DSH 实际
 * 服务的产物。产物必须提交；CI 只对产物执行 node --check（见 .github/workflows/ci.yml）。
 *
 * parts 顺序固定（build.mjs 的 pieces）：i18n → panel → overflow → styles。
 *
 * 侧边栏走**宿主原生扩展点**（issue #187 批 1），不再消费第三方侧边栏服务：
 * ctx.sidebarRightTabs.register 注册页面类型（guide 胶囊供用户从右栏指南页打开），
 * slots 的 sidebar.right.pane.tab / .title 两个 keyed 席位注册面板与标题（key =
 * 类型 id）。原生能力经 Cordis 服务名 inject 获取（slots / sidebarRightTabs），
 * 无需 require 任何 @deepseek-ai/dsh-client-ui-* 包（官方范本：
 * dsh-client-ui-sidebar-files/lib/client.js:681-711）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-context',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    // 原生页签身份（issue #187 批 1）：id = 包名（全局唯一，也是席位 key），
    // kind = 迁移前 better-sidebar 的 tab id，order = 迁移前的指南页顺序。
    const TAB_ID = 'dsh-my-context'
    const TAB_KIND = 'dsh-my-context:context'
    const TAB_ORDER = 43

    // ── parts（scripts/build.mjs 拼接；顺序固定）───────────────────────
    /*__PART_I18N__*/
    /*__PART_PANEL__*/
    /*__PART_OVERFLOW__*/
    /*__PART_STYLES__*/

    // ── 插件体：样式注入 + 原生页签注册 ─────────────────────────────────
    exports.inject = ['slots', 'sidebarRightTabs']

    /** 指南页胶囊与页签标题共用的惰性文案。 */
    const guideEntry = { order: TAB_ORDER, title: () => strings.tabTitle() }

    /** 原生 tab body 席位：适配成 ContextPanel 的 { visible } 契约。 */
    function ContextTabBody(props) {
      const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
      return createElement(ContextPanel, { visible: info?.tab?.visible !== false })
    }

    /** 原生 tab title 席位：宿主给定标题优先，否则回退本插件文案。 */
    function ContextTabTitle(props) {
      const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
      return createElement('span', null, info?.tab?.title ?? strings.tabTitle())
    }

    exports.apply = function apply(ctx) {
      // 样式先注入：不依赖任何服务（服务缺失/时序未就绪也不影响面板配色）。
      ctx.effect(() => injectStyles(), 'dsh-my-context: styles')

      // 服务缺失（旧宿主）时静默跳过：判空必须同时覆盖 null 与 undefined
      // （typeof null 是 object，会骗过 === undefined 的写法）。
      const tabs = ctx.sidebarRightTabs
      const slots = ctx.slots
      if (tabs == null || slots == null) return

      ctx.effect(
        () => tabs.register({ id: TAB_ID, kind: TAB_KIND, title: () => strings.tabTitle(), guide: [guideEntry] }),
        'dsh-my-context: context tab',
      )
      ctx.effect(
        () =>
          slots.inject('sidebar.right.pane.tab', () =>
            slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, ContextTabBody),
          ),
        'dsh-my-context: context tab body',
      )
      ctx.effect(
        () =>
          slots.inject('sidebar.right.pane.tab.title', () =>
            slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, ContextTabTitle),
          ),
        'dsh-my-context: context tab title',
      )
    }

    return module.exports
  },
})
