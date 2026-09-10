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
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-context',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    // ── parts（scripts/build.mjs 拼接；顺序固定）───────────────────────
    /*__PART_I18N__*/
    /*__PART_PANEL__*/
    /*__PART_OVERFLOW__*/
    /*__PART_STYLES__*/

    // ── 插件体：样式注入 + 页签注册 ─────────────────────────────────────
    exports.inject = ['betterSidebar']

    exports.apply = function apply(ctx) {
      ctx.effect(() => injectStyles(), 'dsh-my-context: styles')
      const service = ctx.betterSidebar
      if (service === undefined) return
      ctx.effect(
        () =>
          service.registerTab({
            id: 'dsh-my-context:context',
            title: () => strings.tabTitle(),
            order: 43,
            single: true,
            component: (props) => createElement(ContextPanel, props),
          }),
        'dsh-my-context: context tab registration',
      )
    }

    return module.exports
  },
})
