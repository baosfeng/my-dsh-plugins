/**
 * dsh-my-skill-manager — client half (browser). SOURCE TEMPLATE.
 *
 * A Web Settings "Skill 管理 / Skill Manager" tab (official `slots`
 * extension point — no third-party dependency) implementing the "技能台"
 * (Skill Deck) layout: command bar, cards / compact table views, filters,
 * dual-scope switches (global + current project), focus detail with a
 * SKILL.md preview, batch enable/disable, diagnostics page, toasts and the
 * loading / empty / error states.
 *
 * Data source: /my-skill-manager/api/{list,detail,rescan,session,config}
 * (server half). Styling uses the host's --dsw-* semantic tokens only.
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

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    __PART_I18N__
    __PART_ICONS__
    __PART_GLYPHS__
    __PART_STYLE_TOKENS__
    __PART_STYLE_CHROME__
    __PART_STYLE_DECK__
    __PART_STYLE_TABLE__
    __PART_STYLES__
    __PART_API__
    __PART_MODEL__
    __PART_COMPONENTS_UI__
    __PART_COMPONENTS_DETAIL__
    __PART_COMPONENTS_CARDS__
    __PART_COMPONENTS_TABLE__
    __PART_COMPONENTS_CHROME__
    __PART_COMPONENTS_TOOLBAR__
    __PART_COMPONENTS_STATE__
    __PART_COMPONENTS_DIAG__
    __PART_DECK_STATE__
    __PART_DECK_DATA__
    __PART_DECK_ACTIONS__
    __PART_VIEW_RENDER__
    __PART_VIEW__
    __PART_APPLY__

    return module.exports
  },
})
