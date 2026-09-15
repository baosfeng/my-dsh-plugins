/**
 * dsh-think-zh-expand — client half (browser).
 *
 * 功能 2：思考（reasoning）内容默认展开显示。
 * 功能 3：界面标签中文化。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 先 tsc 编译
 * src/client/index.ts → lib/.client-build/index.js（CommonJS 单文件），
 * 再把编译产物注入到下方 /*__CLIENT_BUNDLE__* / 占位符处并写出
 * lib/client.js（DSH 实际提供的产物，单一 __ModuleLoader__ bundle，无相对
 * 路径 require）。产物必须提交（CI 只跑 node --check + 测试，不跑构建）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-think-zh-expand',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // useState 由编译后的 client bundle 使用；模板静态分析看不到 bundle 内容。
    const { createElement, useState } = require('react')

    // ── MarkdownView：三级渲染回退（issue #293；逻辑收口于共享部件 #299）──
    // 1) dsh-md-render 的 MarkdownView —— 首选渲染内核（issue #31/#186 决策不变）；
    // 2) 宿主 staticModules 的官方 MarkdownText（零安装，缺 md-render 时仍渲染）；
    // 3) <pre data-dsh-think-zh-expand-fallback="true"> —— 极旧/裁剪宿主纯文本。
    // 三级链、组件可用性判定（React 语义，兼容 memo/forwardRef 对象）与假降级教训
    // 都在 dsh-shared/client-parts/markdown-fallback.part.js（issue #299：与
    // dsh-my-plugin-manager 共用单一来源，ADR-0002），构建期 splice 进本 factory 作用域。
    /*__PART_MARKDOWN_FALLBACK__*/
    // labels 无默认值（仅渲染含代码块的 markdown 时才读 labels.code.copyLabel），
    // 中文文案由本中文化插件提供；codeLabels 兼容早期官方包（npm 0.0.1-rc.1）。
    const ZH_MD_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }
    const ZH_MD_CODE_LABELS = { copyLabel: '复制', copiedLabel: '已复制' }
    const MarkdownView = installMarkdownViewFallback({
      require,
      createElement,
      labels: ZH_MD_LABELS,
      codeLabels: ZH_MD_CODE_LABELS,
      fallbackAttribute: 'data-dsh-think-zh-expand-fallback',
    })

    // ── 共享图标（issue #54 阶段 0：dsh-shared/client-parts）──────────
    /*__PART_ICONS__*/

    // ── 共享样式注入（dsh-shared/client-parts，issue #186 P2）────────
    /*__PART_STYLE_TAG__*/

    // ── Client bundle（编译自 src/client/index.ts）──────────────────
    /*__CLIENT_BUNDLE__*/

    return module.exports
  },
})
