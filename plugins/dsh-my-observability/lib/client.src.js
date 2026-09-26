/**
 * dsh-my-observability — client half (browser). SOURCE TEMPLATE.
 *
 * 提供两个侧边栏页签：
 *  - 资源监控（dsh-my-observability:resources）：审计文件大小 / 写入速率 +
 *    本进程 CPU / 内存（资源看门狗的可视面，数据来自
 *    /observability/api/resources）；
 *  - Git 工具 + 增量 diff 审查（dsh-my-observability:git）：仓库状态与
 *    差异查看、类型化提交（Conventional Commits）、提交前规则引擎 +
 *    可选 AI 审查（/observability/api/git/* 与 /observability/api/review）。
 *
 * 轨迹回放面板**已移除**（官方 @deepseek-ai/dsh-client-ui-trajectory 自
 * 0.1.7-rc.2 起默认装载，提供按轮次的事件记录表 + 交互式时间概览与检查器）。
 * 本插件保留的真增量是 host 侧的审计落盘与查询 API（/observability/api 的
 * sessions / events 端点）、结构化 Git 工具、提交前增量 diff 审查与资源看门狗。
 *
 * 面板可见（visible）时轮询（RESOURCE_POLL_MS），隐藏时暂停（省请求）。
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * 侧边栏走**宿主原生扩展点**（issue #187 批 1），不再消费第三方侧边栏服务：
 * sidebarRightTabs 注册页签类型（guide 胶囊供用户从右栏指南页打开），slots 的
 * sidebar.right.pane.tab / .title 两个 keyed 席位注册面板与标题（key = 类型 id）。
 * 原生能力经 Cordis 服务名 inject 获取，无需 require 任何
 * @deepseek-ai/dsh-client-ui-* 包（官方范本：
 * dsh-client-ui-sidebar-files/lib/client.js:681-711）。
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs
 * 先编译 client TS 片段（src/client/parts/*.ts → lib/.client-build/parts/*.js），
 * 再将这些片段（无 import/export 的纯函数声明文本；图标片段来自 dsh-shared
 * 共享 client-parts，见 docs/UI规范.md）经下方 __PART_*__ 占位符（函数式
 * replaceAll，避免 $&/$1 特殊解释）拼接进 factory 作用域，写出
 * lib/client.js —— 即 DSH 实际服务的产物。产物必须提交；CI 只对产物执行
 * node --check（见 scripts/test-all.sh / .github/workflows/ci.yml）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-observability',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    // 原生页签身份（issue #187 批 1）：id/kind 与迁移前 better-sidebar 的 tab id 同约定（每面板一个类型，id 全局唯一且是席位 key），order 为指南页顺序。
    const RESOURCE_TAB_ID = 'dsh-my-observability:resources'
    const GIT_TAB_ID = 'dsh-my-observability:git'
    const RESOURCE_TAB_ORDER = 40
    const GIT_TAB_ORDER = 41

    // ── parts（scripts/build.mjs 拼接；顺序固定）───────────────────────
    /*__PART_NATIVE_TABS__*/
    /*__PART_I18N__*/
    /*__PART_ICONS__*/
    /*__PART_API__*/
    /*__PART_RESOURCE__*/
    /*__PART_GIT__*/
    /*__PART_SETTINGS__*/
    /*__PART_STYLES__*/

    // ── 插件体：样式注入 + 两个原生页签注册 ─────────────────────────────
    exports.inject = ['slots', 'sidebarRightTabs']

    /** 原生 tab body 席位：资源面板要 visible（隐藏时暂停采样轮询）。 */
    function ResourceTabBody(props) {
      const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
      return createElement(ResourcePanel, { resource: useResourceState(info?.tab?.visible !== false) })
    }

    /** Git 面板不接 props（迁移前组件工厂同样只是透传）。 */
    function GitTabBody() {
      return createElement(GitPanel, null)
    }

    exports.apply = function apply(ctx) {
      // 样式先注入：不依赖任何服务（服务缺失/时序未就绪也不影响面板配色）。
      ctx.effect(() => injectStyles(), 'dsh-my-observability: styles')

      // 设置页签（issue #383）：只依赖 slots（strict=false 读取），与侧边栏面板所需的 sidebarRightTabs 无关，故先于判空注册。
      attachObservabilitySettingsTab(ctx)

      const { sidebarRightTabs: tabs, slots } = ctx
      // 判空必须同时覆盖 null 与 undefined（typeof null 是 object，会骗过 === undefined）。
      if (tabs == null || slots == null) return

      registerNativeTab(ctx, tabs, slots, {
        id: RESOURCE_TAB_ID,
        order: RESOURCE_TAB_ORDER,
        label: 'resources',
        title: () => strings.resourceTitle(),
        Body: ResourceTabBody,
        Title: nativeTabTitle(() => strings.resourceTitle()),
      })
      registerNativeTab(ctx, tabs, slots, {
        id: GIT_TAB_ID,
        order: GIT_TAB_ORDER,
        label: 'git',
        title: () => strings.gitTitle(),
        Body: GitTabBody,
        Title: nativeTabTitle(() => strings.gitTitle()),
      })
    }

    return module.exports
  },
})
