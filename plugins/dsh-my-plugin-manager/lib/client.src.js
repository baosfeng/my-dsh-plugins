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

    // ── README Markdown 渲染：三级回退（issue #299，共享部件）──────────
    // 1) dsh-md-render 的 MarkdownView（首选内核，issue #31；package.json 的
    //    dsh.client.external 声明）；
    // 2) 宿主平台官方 MarkdownText（零安装零体积，缺 md-render 时仍渲染 markdown）；
    // 3) 本插件自己的 <pre class="dsh-my-plugin-manager-readme-plain">（issue #90）。
    // 逻辑收口在 dsh-shared/client-parts/markdown-fallback.part.js（issue #299：
    // 同一段样板 ≥2 处即抽出），构建期 splice 进本 factory 作用域。
    __PART_MARKDOWN_FALLBACK__
    const MD_README_LABELS = {
      code: { copyLabel: '复制', copiedLabel: '已复制' },
      footnotes: '脚注',
    }
    const MD_README_CODE_LABELS = { copyLabel: '复制', copiedLabel: '已复制' }
    const MarkdownView = installMarkdownViewFallback({
      require,
      createElement,
      labels: MD_README_LABELS,
      codeLabels: MD_README_CODE_LABELS,
      fallbackAttribute: 'data-dsh-my-plugin-manager-fallback',
      fallbackClassName: 'dsh-my-plugin-manager-readme-plain',
    })

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
