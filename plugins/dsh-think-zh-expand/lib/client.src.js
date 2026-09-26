/**
 * dsh-think-zh-expand — client half (browser).
 *
 * 功能 2：思考（reasoning）内容默认展开显示。
 * 功能 3：宿主设置面板（设置 → 插件 → 思考增强）。
 *
 * issue #428：界面标签中文化词表已移除（官方 zh locale 已是文案真源）。
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
    // useState 由编译后的 client bundle 使用，useEffect 供设置页 part 使用；
    // 模板静态分析看不到 bundle / part 的内容，故在此一并解构。
    const { createElement, useState, useEffect } = require('react')

    // ── MarkdownView：宿主官方 baseline 组件（issue #428）──────────────
    // 1) 宿主 staticModules 的官方 MarkdownText —— 唯一渲染内核（平台 seed 模块
    //    @deepseek-ai/dsh-client-ui-primitives，零安装零体积，官方推荐路线）；
    // 2) <pre data-dsh-think-zh-expand-fallback="true"> —— 极旧/裁剪宿主纯文本。
    // **不再有「另一个特性插件提供渲染器」这一级**：官方明令禁止特性插件
    // runtime-import 彼此的值，也禁止用 dsh.client.external 获取它们
    // （packages/client/AGENTS.md；官方 scripts/verify-client-packages.ts 判违规）。
    // 三级链与组件可用性判定（React 语义，兼容 memo/forwardRef 对象）与假降级教训
    // 仍在 dsh-shared/client-parts/markdown-fallback.part.js（#299 单一来源，ADR-0002），
    // 构建期 splice 进本 factory 作用域；共享件的外部内核级由下方两个参数显式旁路
    // （external 指向平台模块 + 一个不存在的导出名 → 该级恒不命中），共享件本身与
    // 其它消费方（dsh-my-plugin-manager）行为不变。
    /*__PART_MARKDOWN_FALLBACK__*/
    // labels 无默认值（渲染含代码块的 markdown 时才读 labels.code.copyLabel）——
    // 这是官方组件的**必填调用契约**，不是界面文案替换。
    /** 官方 baseline 模块（平台 seed 表，可直接 require）。 */
    const PLATFORM_PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives'
    const ZH_MD_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }
    const MarkdownView = installMarkdownViewFallback({
      require,
      createElement,
      labels: ZH_MD_LABELS,
      fallbackAttribute: 'data-dsh-think-zh-expand-fallback',
      // 显式旁路共享件的外部内核级（见上方注释）：本插件不跨插件取渲染内核
      external: PLATFORM_PRIMITIVES,
      externalExport: 'externalRendererDisabled',
    })

    // ── 共享图标（issue #54 阶段 0：dsh-shared/client-parts）──────────
    /*__PART_ICONS__*/

    // ── 共享样式注入（dsh-shared/client-parts，issue #186 P2）────────
    /*__PART_STYLE_TAG__*/

    // ── 设置页 part（src/client/settings.ts 产物，issue #383）──────────
    // 无 import/export 的片段：与上方共享件、下方编译产物共享本 factory 作用域
    // （React API 来自上方解构，installStyles 来自上方共享样式件）。
    /*__PART_SETTINGS__*/

    // ── Client bundle（编译自 src/client/index.ts）──────────────────
    /*__CLIENT_BUNDLE__*/

    return module.exports
  },
})
