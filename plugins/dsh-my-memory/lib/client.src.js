/**
 * dsh-my-memory — client half (browser). SOURCE TEMPLATE.
 *
 * A Web Settings "记忆 / Memory" tab (official `slots` extension point — no
 * third-party dependency) showing the GLOBAL and PROJECT memory scopes side
 * by side, with add / edit / delete. Every write goes through a custom
 * confirmation UI (built on the ask pattern, NOT the native browser
 * confirm): delete is a red, eye-catching two-step confirm; save/add is
 * green. The project scope is visually distinct (project-root badge +
 * different section accent) so the two scopes never blur together.
 *
 * Data source: GET /my-memory/api/memory + POST /my-memory/api/memory
 * (server half). Writes carry `confirmed: true` — the server refuses any
 * write without the user-consent marker.
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs compiles
 * `src/client/parts/*.ts` to `lib/.client-build/parts/*.js` and splices those
 * fragments into the PART placeholder markers below (each piece is plain
 * function-declaration text sharing this factory scope; the browser
 * ModuleLoader does not support relative-path require) and writes
 * lib/client.js — the file actually served by DSH, which MUST be committed
 * (CI runs node --check + tests against it, not against this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')
    // 官方 UI 组件库（宿主 staticModules 提供，零安装零体积；组件表见
    // docs/开发指南/官方UI组件库.md）：Input/Pill/Button + 官方线性图标。
    const ui = require('@deepseek-ai/dsh-client-ui-primitives')

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    __PART_I18N__
    __PART_STYLES__
    __PART_API__
    __PART_ICONS__
    __PART_UTILS__
    __PART_VIEW_ROWS__
    __PART_CANDIDATES__
    __PART_VIEW__
    __PART_APPLY__

    return module.exports
  },
})
