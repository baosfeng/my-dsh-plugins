/**
 * dsh-md-render — client half (browser)，合并 think-zh-expand + mermaid-render（issue #463）。
 *
 * 职责边界（**只做 markdown 内容的渲染**）：markdown 文本、代码样式、图表渲染、
 * 思考 markdown 渲染；**其他一律保持官方默认样式**。
 *
 *  - 官方渲染器接入（official-view）：表格（GFM + 宽表格）、公式（KaTeX）、
 *    代码块（shiki 高亮 / 语言标签 / 行号 / 复制）全部来自平台 seed 模块
 *    @deepseek-ai/dsh-client-ui-primitives 的 MarkdownText；
 *  - 真增量①：text / plaintext / txt 围栏块按 markdown 渲染 + 每块「查看原文」切换；
 *  - 真增量②：pre[data-context-text] 上下文注入块按 markdown 渲染；
 *  - 真增量③：整段 markdown 复制按钮（官方只有代码块复制）；
 *  - 真增量④：统一 MarkdownView 导出（供本仓其它插件使用）；
 *  - 真增量⑤：mermaid / mmd 代码块 → 图表卡片（预览 / 代码切换、导出、失败降级回显源码）；
 *  - 真增量⑥：思考块默认展开（对官方折叠行派发一次真实 click，外观 100% 官方）；
 *  - 真增量⑦：设置 → 插件 → 渲染（单 tab 三分组）；
 *  - 真增量⑧（容错子集）：官方 GFM 不认的两种分隔行写法先规范化再交给官方渲染。
 *
 * 硬约束（可机器校验，见 test/static-assertions.mjs）：
 *  - **不注册任何 conversation.chat.node 节点级 seat**（尤其 assistant-step）；
 *  - **不对官方元素写 style / class / aria**：DOM 注入只用自有 CSS + 自有 data-* 标记；
 *  - **不读 React fiber 私有属性**（__reactFiber$）；
 *  - 单 MutationObserver（一个扫描器按语言分流）。
 *
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation 注入、
 * fiber teardown 卸载（HMR / 禁用无残留）。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 把编译后的片段注入到
 * 下方 /*__PART_*__* / 占位符处并写出 lib/client.js（DSH 实际提供的产物，单一
 * __ModuleLoader__ bundle，无相对路径 require）。产物必须提交（CI 只跑
 * node --check + 测试，不跑构建）；片段为纯函数声明文本（无 import/export），
 * 注入后处于本 factory 作用域。
 */
window.__ModuleLoader__.load({
  id: 'dsh-md-render',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // MarkdownView / CopyButton / MermaidCard / 设置页用 createElement + hooks；
    // 注入渲染经 official-view.part.js 的 require 取平台模块。
    const { createElement, useState, useEffect } = require('react')

    // ── 路由路径（构建期由 host 半 lib/routes/paths.js 注入的单一真源）──
    /*__ROUTE_PATHS__*/

    // ── 渲染配置：三段命名空间化开关 + 旧扁平键读兼容 ────────────────
    /*__PART_CONFIG__*/

    // ── 非标准表格容错（官方 GFM 未覆盖的两种写法）──────────────────
    /*__PART_TABLE_NORMALIZE__*/

    // ── 官方渲染器接入（平台 MarkdownText + react-dom/client）────────
    /*__PART_OFFICIAL_VIEW__*/

    // ── 整段 markdown 复制（官方只有代码块复制）─────────────────────
    /*__PART_COPY__*/

    // ── 统一 MarkdownView：对外公共 API（官方渲染 + 整段复制）────────
    /*__PART_MARKDOWN_VIEW__*/

    // ── 上下文注入块 markdown 渲染（pre[data-context-text]）─────────
    /*__PART_CONTEXT_MARKDOWN__*/

    // ── text / plaintext / txt 围栏块按 markdown 渲染 + 查看原文 ────
    /*__PART_TEXT_MARKDOWN__*/

    // ── 思考块默认展开（对官方折叠行派发一次 click；不改外观）────────
    /*__PART_THINK__*/

    // ── mermaid 引擎按需加载 + 离屏渲染 ────────────────────────────
    /*__PART_MERMAID_ENGINE__*/

    // ── mermaid 图表卡片（预览 / 代码切换、导出、失败回显源码）──────
    /*__PART_MERMAID_CARD__*/

    // ── mermaid 代码块识别 + 流式稳定窗口 ──────────────────────────
    /*__PART_MERMAID_SCAN__*/

    // ── mermaid 图表导出（PNG / SVG 下载 + 复制源码）────────────────
    /*__PART_MERMAID_EXPORT__*/

    // ── 共享 DOM 扫描骨架 + 单 MutationObserver 按语言分流 ──────────
    /*__PART_DOM_SCANNER__*/
    /*__PART_SCANNER__*/

    // ── 样式（DSH 语义 token，随 activation 注入）──────────────────
    /*__PART_STYLES__*/

    // ── 共享样式注入 / 图标集（dsh-shared/client-parts）─────────────
    /*__PART_STYLE_TAG__*/
    /*__PART_ICONS__*/

    // ── 设置页：文案 / 样式（i18n）+ 三分组视图 + tab 注册（单 tab）──
    /*__PART_SETTINGS_STRINGS__*/
    /*__PART_SETTINGS_VIEW__*/
    /*__PART_SETTINGS__*/

    // ── 插件入口：样式注入 + 扫描器装配 + 设置页 ───────────────────
    /*__PART_APPLY__*/

    return module.exports
  },
})
