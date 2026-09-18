/**
 * dsh-my-remote — client half (browser). SOURCE TEMPLATE（issue #385）。
 *
 * 本插件原本是**纯 server 插件**；client 半只为承载「设置 → 插件 → 远程控制」
 * 面板：可视化编辑 apiToken（掩码）/ askTimeoutMs / approvalTimeoutMs /
 * webhooks[]，保存走 PUT /remote/settings/api/settings（host 半写回 profile
 * patch + 立即热生效）。
 *
 * BUILD NOTE: 本文件是**模板源码**，不是 DSH 实际服务的文件。scripts/build.mjs
 * 把 dsh-shared 的共享样式样板与 lib/parts/*.js 的片段按下方占位符拼接进来，
 * 写出 lib/client.js —— DSH 实际服务的 __ModuleLoader__ bundle（单一 factory
 * 作用域，无相对路径 require）。产物必须提交（CI 只跑 node --check + 测试，
 * 不跑构建）。
 *
 * 片段之间共享本 factory 作用域（函数声明可直接互调；模板里刻意**不**写它们的
 * 名字，避免 ESLint no-undef —— lib/parts/*.js 的规则已关闭 no-undef）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-remote',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // React API：设置页视图使用 createElement / useState / useEffect。
    const { createElement, useState, useEffect } = require('react')

    // ── 共享样式注入样板（dsh-shared/client-parts，issue #186 P2）──────
    /*__PART_STYLE_TAG__*/

    // ── 设置页片段（lib/parts/*.js，issue #385）──────────────────────
    // 顺序有依赖：样式常量 → i18n 文案 → 配置模型/加载保存 → 通用视图 →
    // webhook 编辑器 → 主视图与页签注册（后者引用前面全部）。
    /*__PART_SETTINGS__*/

    // 插件入口：只注册设置页签（attachSettingsTab 由上面的片段声明、同处本作用域）。
    // 刻意**不声明 inject: ['slots']**：设置页是增强能力，用 ctx.get('slots', false)
    // 主动查询并在缺失时静默跳过——硬 inject 会让本 client 在没有 slots 的宿主上
    // 永远 PENDING。
    module.exports.apply = function apply(ctx) {
      attachSettingsTab(ctx)
    }

    return module.exports
  },
})
