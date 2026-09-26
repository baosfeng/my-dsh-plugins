/**
 * dsh-my-plugin-manager — client half (browser). SOURCE TEMPLATE.
 *
 * A Web Settings "插件市场 / Plugin Market" tab (official `slots` extension
 * point — no third-party dependency) with two read-only sections:
 *  - 更新检查: `dsh plugin outdated` → 列出「当前 → 最新」（官方无 outdated 面）；
 *  - 市场: npm registry 关键词搜索 + 插件详情（README / 版本历史 / 依赖 / 月下载量）。
 *
 * 安装 / 卸载 / 启停 / 清单管理**不在本插件范围**：官方默认内置
 * （bundle/web-app 默认装载 ui-plugin-manager、tool-plugin-manager、`dsh plugin`
 * CLI），且官方刻意让设置页插件列表保持只读——本插件不再在其上叠一层可写管理。
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

    // ── README Markdown 渲染：官方 baseline 组件（issue #299 / #428）────────
    // 1) 宿主 staticModules 的官方 MarkdownText —— 唯一渲染内核（平台 seed 模块
    //    @deepseek-ai/dsh-client-ui-primitives，零安装零体积，官方推荐路线）；
    // 2) 本插件自己的 <pre class="dsh-my-plugin-manager-readme-plain">（issue #90）。
    // **不再有「另一个特性插件提供渲染器」这一级**：官方明令禁止特性插件
    // runtime-import 彼此的值，也禁止用 dsh.client.external 获取它们
    // （packages/client/AGENTS.md；官方 scripts/verify-client-packages.ts 判违规）。
    // 三级链与组件可用性判定（React 语义，兼容 memo/forwardRef 对象）与假降级教训
    // 仍在 dsh-shared/client-parts/markdown-fallback.part.js（#299 单一来源），构建期
    // splice 进本 factory 作用域；共享件的外部内核级由下方两个参数显式旁路
    // （external 指向平台模块 + 一个不存在的导出名 → 该级恒不命中），共享件本身与
    // 其它消费方（dsh-think-zh-expand）行为不变。
    __PART_MARKDOWN_FALLBACK__
    /** 官方 baseline 模块（平台 seed 表，可直接 require）。 */
    const PLATFORM_PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives'
    const MD_README_LABELS = {
      code: { copyLabel: '复制', copiedLabel: '已复制' },
      footnotes: '脚注',
    }
    const MarkdownView = installMarkdownViewFallback({
      require,
      createElement,
      labels: MD_README_LABELS,
      fallbackAttribute: 'data-dsh-my-plugin-manager-fallback',
      fallbackClassName: 'dsh-my-plugin-manager-readme-plain',
      external: PLATFORM_PRIMITIVES,
      externalExport: 'externalRendererDisabled',
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
