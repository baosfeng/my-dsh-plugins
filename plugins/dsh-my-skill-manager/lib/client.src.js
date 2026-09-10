/**
 * dsh-my-skill-manager — client half (browser). SOURCE TEMPLATE.
 *
 * A Web Settings "Skill 管理 / Skill Manager" tab (official `slots`
 * extension point — no third-party dependency) showing:
 *  - the skill catalog grouped by 全局 / 项目 scope,
 *  - an enable/disable toggle per skill for the global scope and for the
 *    current project (project config lives in <projectRoot>/.dsh/skills.enabled.json),
 *  - a project-path input to pick which project's config is edited.
 *
 * Data source: GET /my-skill-manager/api/list + PUT /my-skill-manager/api/config
 * (server half). Styling follows the DSH design language: semantic tokens,
 * flat surfaces, hairline borders.
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs compiles
 * src/client/parts/*.ts into lib/.client-build/parts/*.js and splices those
 * pieces into the PART placeholder markers below
 * (each piece is plain function-declaration text sharing this factory scope;
 * the browser ModuleLoader does not support relative-path require) and writes
 * lib/client.js — the file actually served by DSH, which MUST be committed
 * (CI runs node --check + tests against it, not against this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-skill-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')
    // 官方 UI 组件库（宿主 staticModules 提供，零安装零体积；组件表见
    // docs/开发指南/官方UI组件库.md）：Pill/Button + 官方线性图标。
    const ui = require('@deepseek-ai/dsh-client-ui-primitives')

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    __PART_I18N__
    __PART_ICONS__
    __PART_STYLES__
    __PART_API__
    __PART_VIEW__
    __PART_APPLY__

    return module.exports
  },
})
