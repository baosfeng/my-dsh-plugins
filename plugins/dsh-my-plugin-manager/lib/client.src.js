/**
 * dsh-my-plugin-manager — client half (browser). SOURCE TEMPLATE.
 *
 * A Web Settings "插件管理 / Plugin Manager" tab (official `slots` extension
 * point — no third-party dependency) with two sections:
 *  - 已安装: loader inventory (name / version / state) + uninstall per row
 *    + an update check (`pnpm outdated`) with a one-click hint;
 *  - 市场: npm registry search with one-click install (installs land in the
 *    profile via `dsh plugin add`; a restart loads them).
 *
 * Data source: GET/POST /my-plugin-manager/api/* (server half). Styling follows
 * the DSH design language (issue #54): semantic tokens, flat surfaces, hairline
 * borders, shared linear icons (dsh-shared client-parts), brand badges and
 * icon buttons — the dsh-file-activity visual baseline.
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs compiles the
 * `src/client/parts/*.ts` pieces (plus the shared dsh-shared client-parts) and
 * splices them into the PART placeholder markers below (each piece is plain
 * function-declaration text sharing this factory scope; the browser
 * ModuleLoader does not support relative-path require) and writes
 * lib/client.js — the file actually served by DSH, which MUST be committed
 * (CI runs node --check + tests against it, not against this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-plugin-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')
    // README Markdown 渲染复用 dsh-md-render 的统一 MarkdownView（issue #31
    // 跨插件 require 模式，package.json dsh.client.external 声明）；该插件
    // 不可用时回退纯文本 <pre>（issue #90 加载兜底）。
    let MarkdownView = null
    try {
      MarkdownView = require('dsh-md-render').MarkdownView
    } catch {
      MarkdownView = null
    }

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    __PART_I18N__
    __PART_ICONS__
    __PART_STYLES__
    __PART_API__
    __PART_VIEW__
    __PART_DETAIL__
    __PART_APPLY__

    return module.exports
  },
})
