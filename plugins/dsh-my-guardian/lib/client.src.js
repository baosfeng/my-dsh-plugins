/**
 * dsh-my-guardian — client half (browser). SOURCE TEMPLATE.
 *
 * A dsh-better-sidebar tab ("插件守护 / Plugin Guardian") showing the staged
 * and promoted plugin entries managed by the server half:
 *  - per-entry status (running / pending / failed ×N / frozen),
 *  - the last error for failed entries (expandable),
 *  - actions: retry (unfreeze + remount), remove from the roster,
 *  - a safe-mode switch that unmounts everything the guardian mounted.
 *
 * Data source: GET/POST /guardian/api/* (server half), polled while the tab
 * is visible. Styling follows the better-sidebar design language: DSH
 * semantic tokens, flat surfaces, hairline borders.
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs compiles the
 * client halves (`src/client/parts/*.ts` → `lib/.client-build/parts/*.js`),
 * publishes them as `lib/parts/*.js` and splices those pieces into the PART
 * placeholder markers below (each piece is plain function/variable-declaration
 * text sharing this factory scope; the browser ModuleLoader does not support
 * relative-path require) and writes lib/client.js — the file actually served
 * by DSH, which MUST be committed (CI runs node --check + tests against it,
 * not against this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-guardian',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    const TAB_ID = 'dsh-my-guardian:panel'
    const POLL_MS = 5000

    // ── parts (compiled from src/client/parts/*.ts, injected by
    //    scripts/build.mjs; keep this exact order — the const initializers
    //    below run in splice order) ───────────────────────────────────────
    __PART_STYLES__
    __PART_UTIL__
    __PART_ICONS__
    __PART_ROW__
    __PART_VIEW__
    __PART_APPLY__

    return module.exports
  },
})
