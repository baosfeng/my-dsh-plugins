/**
 * dsh-task-reliability — client half (browser).
 *
 * 侧边栏「任务可靠性」页签：
 *  - 三个模式开关：可靠性跟踪（自动跟踪 goal 任务）、完成度校验（任务默认
 *    校验模式）、自主决策（出行模式：拦截 ask 自动决策 + 自动批准）；
 *  - 活动任务列表：状态徽标 / 描述 / 循环次数 / 校验次数，操作：标记完成、
 *    暂停、恢复、删除（全部走 /task-reliability/api/* HTTP API）；
 *  - 待确认问题列表：自主决策模式拦截下的 ask 问题，可远程/本地回答；
 *  - 注册任务：以当前会话 id 预填，可改会话、描述、模式。
 *
 * 数据源：server 端持久化注册表（/task-reliability/api/*），页签每 6s 轮询。
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation 注入、
 * fiber teardown 卸载。
 *
 * 侧边栏走**宿主原生扩展点**（issue #187 批 1），不再消费第三方
 * dsh-better-sidebar 服务：ctx.sidebarRightTabs.register 注册页面类型，
 * slots 的 sidebar.right.pane.tab / .title 两个 keyed 席位注册面板与标题。
 * 原生能力经 Cordis 服务名 inject 获取（无 require 官方 UI 包）。
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs compiles
 * src/client/parts/*.ts and splices them into the PART placeholder markers
 * below (each piece is plain function-declaration text sharing this factory
 * scope — the browser ModuleLoader does not support relative-path require),
 * then writes lib/client.js, the file actually served by DSH, which MUST be
 * committed (CI runs node --check + tests against it, not this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-task-reliability',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    /** 迁移前 better-sidebar 的 tab id：现为原生 kind，并保留为面板身份语义。 */
    const TAB_ID = 'task-reliability:panel'
    /** 原生页签类型实现身份（官方惯例：包名；全局唯一，也是席位的 key）。 */
    const TAB_ID_PKG = 'dsh-task-reliability'
    /** 指南页相对顺序（沿用迁移前 better-sidebar 的 order）。 */
    const TAB_ORDER = 70
    const POLL_MS = 6000

    // 侧边栏走宿主原生扩展点（issue #187 批 1），不再消费第三方侧边栏服务。
    exports.inject = ['slots', 'sidebarRightTabs']

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    __PART_I18N__
    __PART_API__
    __PART_STYLES__
    __PART_ROWS__
    __PART_VIEW__
    __PART_SETTINGS__
    __PART_APPLY__

    return module.exports
  },
})
