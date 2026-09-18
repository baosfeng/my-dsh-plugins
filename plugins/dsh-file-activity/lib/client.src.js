/**
 * dsh-file-activity — client half (browser).
 *
 * A native right-Sidebar tab ("文件活动 / File Activity") built on the HOST's
 * own extension points (issue #187 batch 2 — no third-party sidebar service):
 *  - the tab type registers into `ctx.sidebarRightTabs` (stage one) and its
 *    body / chip title into the keyed `sidebar.right.pane.tab` and
 *    `sidebar.right.pane.tab.title` seats (stage two);
 *  - clicking a file opens a FLOATING preview implemented by this plugin inside
 *    the `shell.overlay` list seat: recent access history (agent + plugin
 *    routes), per-file create/modify/read counts flattened by folder, and the
 *    preview window itself — clicking outside / Esc / × closes it;
 *  - a document-preview descriptor registers with `ctx.documentPreviews`
 *    (metadata only: the native document owner reads the bytes);
 *  - auto-opens once per session by default, with its toggle in the Web
 *    Settings → Plugins tab (`settings.plugins.tab`).
 *
 * Data source: the plugin host half (fs/observed for agent tools) + this
 * half's fetch interception for the plugin's own file routes, both persisted
 * host-side; the tab polls /file-activity/api/stats.
 *
 * Styling follows the DSH design language: all colors ride the DSH semantic
 * tokens (--dsw-alias-*), typography rides the font roles (--dsw-font-*),
 * motion rides --ds-*. Flat surfaces (no box-shadow), hairline borders, 28px
 * circular icon controls with hover fills, and 8px-radius rows with hover
 * fills. The stylesheet is injected once per activation and torn down with the
 * fiber, so HMR/disable leaves no residue.
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs splices the
 * `lib/parts/*.part.js` pieces into the PART placeholder markers below (each
 * piece is plain function-declaration text sharing this factory scope; the
 * browser ModuleLoader does not support relative-path require) and writes
 * lib/client.js — the file actually served by DSH, which MUST be committed
 * (CI runs node --check + tests against it, not against this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-file-activity',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useMemo, useState, useSyncExternalStore } = require('react')

    const TAB_ID = 'dsh-file-activity'
    const TAB_KIND = 'file-activity'
    const PREVIEW_ID = 'dsh-file-activity-preview'
    const AUTO_OPEN_KEY = 'dsh-file-activity:auto-opened:'
    const AUTO_OPEN_PREF_KEY = 'dsh-file-activity:autoOpen'
    // Right column default width ratio in percent (issue #384).
    const RIGHTBAR_PREF_KEY = 'dsh-file-activity:rightbarWidth'
    const POLL_MS = 6000

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    __PART_I18N__
    __PART_FORMAT__
    __PART_TREE__
    __PART_STORE__
    __PART_API__
    __PART_INTERCEPTOR__
    __PART_AUTO_OPEN__
    __PART_DOCUMENT_PREVIEWS__
    __PART_ICONS__
    __PART_STYLES__
    __PART_ROWS__
    __PART_VIEW__
    __PART_PREVIEW_DATA__
    __PART_PREVIEW__
    __PART_RIGHTBAR_WIDTH__
    __PART_SETTINGS__
    __PART_APPLY__

    return module.exports
  },
})
