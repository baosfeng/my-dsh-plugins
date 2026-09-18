/**
 * dsh-my-guard — client half (browser). SOURCE TEMPLATE.
 *
 * 提供侧边栏页签「安全护栏」（dsh-my-guard:guard）：
 *  - 告警列表：破坏性命令 / 投毒扫描 / 提示注入三类告警（类型徽标 +
 *    严重度 + 时间 + 消息 + 详情），每条可「确认」（用户确认机制）；
 *  - 投毒扫描工具：输入包名/本地路径 → 扫描 → 显示发现项；
 *  - 提示注入检测工具：输入文本 → 检测 → 显示命中规则。
 *
 * 面板可见（visible）时轮询（GUARD_POLL_MS），隐藏时暂停（省请求）。
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * 侧边栏走**宿主原生扩展点**（issue #187 批 1），不再消费第三方侧边栏服务：
 * ctx.sidebarRightTabs.register 注册页面类型（guide 胶囊供用户从右栏指南页打开），
 * slots 的 sidebar.right.pane.tab / .title 两个 keyed 席位注册面板与标题（key =
 * 类型 id）。原生能力经 Cordis 服务名 inject 获取（slots / sidebarRightTabs），
 * 无需 require 任何 @deepseek-ai/dsh-client-ui-* 包（官方范本：
 * dsh-client-ui-sidebar-files/lib/client.js:681-711）。
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs
 * 将片段文件（lib/parts/i18n.js / panel.js / styles.js + 共享
 * dsh-shared/client-parts/icons.part.js，均为无 import/export 的纯函数声明
 * 文本）经下方 __PART_*__ 占位符（函数式 replaceAll，避免 $&/$1 特殊解释）
 * 拼接进 factory 作用域，写出 lib/client.js —— 即 DSH 实际服务的产物。
 * 产物必须提交；CI 只对产物执行 node --check（见 .github/workflows/ci.yml）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-guard',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    // 原生页签身份（issue #187 批 1）：id = 包名（全局唯一，也是席位 key），
    // kind = 迁移前 better-sidebar 的 tab id，order = 迁移前的指南页顺序。
    const TAB_ID = 'dsh-my-guard'
    const TAB_KIND = 'dsh-my-guard:guard'
    const TAB_ORDER = 42

    // ── parts（scripts/build.mjs 拼接；顺序固定）───────────────────────
    /*__PART_I18N__*/
    /*__PART_ICONS__*/
    /*__PART_PANEL__*/
    /*__PART_STATES__*/
    /*__PART_RULES__*/
    /*__PART_SETTINGS__*/
    /*__PART_STYLES__*/

    // ── 插件体：样式注入 + 原生页签注册 ─────────────────────────────────
    exports.inject = ['slots', 'sidebarRightTabs']

    /** 指南页胶囊与页签标题共用的惰性文案。 */
    const guideEntry = { order: TAB_ORDER, title: () => strings.tabTitle() }

    exports.apply = function apply(ctx) {
      // 样式先注入：不依赖任何服务（服务缺失/时序未就绪也不影响面板配色）。
      ctx.effect(() => injectStyles(), 'dsh-my-guard: styles')

      // 设置页页签（设置 → 插件 → 安全护栏）：只依赖 slots，侧边栏服务缺失也照常可用。
      attachSettingsTab(ctx)

      const tabs = ctx.sidebarRightTabs
      const slots = ctx.slots
      // 判空必须同时覆盖 null 与 undefined（typeof null 是 object，会骗过 === undefined）。
      if (tabs == null || slots == null) return

      ctx.effect(
        () => tabs.register({ id: TAB_ID, kind: TAB_KIND, title: () => strings.tabTitle(), guide: [guideEntry] }),
        'dsh-my-guard: guard tab type',
      )
      ctx.effect(
        () =>
          slots.inject('sidebar.right.pane.tab', () =>
            slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, GuardTabBody),
          ),
        'dsh-my-guard: guard tab body',
      )
      ctx.effect(
        () =>
          slots.inject('sidebar.right.pane.tab.title', () =>
            slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, GuardTabTitle),
          ),
        'dsh-my-guard: guard tab title',
      )
    }

    return module.exports
  },
})
