/**
 * dsh-my-observability — client half (browser). SOURCE TEMPLATE.
 *
 * 提供两个侧边栏页签：
 *  - 轨迹回放（dsh-my-observability:replay）：按时间轴查看 agent 行为
 *    （agent 状态 / 模型流 / 工具调用与结果），支持会话切换与类型过滤，
 *    数据来自 server 端事件审计（/observability/api/events）；
 *  - Git 工具 + 增量 diff 审查（dsh-my-observability:git）：仓库状态与
 *    差异查看、类型化提交（Conventional Commits）、提交前规则引擎 +
 *    可选 AI 审查（/observability/api/git/* 与 /observability/api/review）。
 *
 * 面板可见（visible）时轮询（REPLAY_POLL_MS），隐藏时暂停（省请求）。
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs
 * 先编译 client TS 片段（src/client/parts/*.ts → lib/.client-build/parts/*.js），
 * 再将这些片段（无 import/export 的纯函数声明文本；图标片段来自 dsh-shared
 * 共享 client-parts，见 docs/UI规范.md；audit-view 片段来自 server 端产物
 * lib/audit-view.js，剥离 export 前缀）经下方 __PART_*__ 占位符（函数式
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

    // ── parts（scripts/build.mjs 拼接；顺序固定）───────────────────────
    /*__PART_I18N__*/
    /*__PART_ICONS__*/
    /*__PART_AUDIT_VIEW__*/
    /*__PART_REPLAY__*/
    /*__PART_RESOURCE__*/
    /*__PART_REPLAY_EXT__*/
    /*__PART_GIT__*/
    /*__PART_STYLES__*/

    // ── 插件体：样式注入 + 两个页签注册 ────────────────────────────────
    exports.inject = ['betterSidebar']

    exports.apply = function apply(ctx) {
      ctx.effect(() => injectStyles(), 'dsh-my-observability: styles')
      const service = ctx.betterSidebar
      if (service === undefined) return
      ctx.effect(
        () =>
          service.registerTab({
            id: 'dsh-my-observability:replay',
            title: () => strings.replayTitle(),
            order: 40,
            single: true,
            component: (props) => createElement(ReplayPanel, props),
          }),
        'dsh-my-observability: replay tab registration',
      )
      ctx.effect(
        () =>
          service.registerTab({
            id: 'dsh-my-observability:git',
            title: () => strings.gitTitle(),
            order: 41,
            single: true,
            component: (props) => createElement(GitPanel, props),
          }),
        'dsh-my-observability: git tab registration',
      )
    }

    return module.exports
  },
})
