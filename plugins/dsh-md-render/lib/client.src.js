/**
 * dsh-md-render — client half (browser).
 *
 * 精简后的职责（**不再自实现任何 markdown 渲染**）：
 *  - 官方渲染器接入（official-view.part）：表格（GFM + 宽表格横向滚动）、
 *    公式（micromark-extension-math + KaTeX）、代码块（shiki 高亮 / 语言
 *    标签 / 行号 / 复制）全部来自平台 seed 模块
 *    @deepseek-ai/dsh-client-ui-primitives 的 MarkdownText（0.1.7-rc.2 内置）；
 *  - 真增量①：text / plaintext / txt 围栏块按 markdown 渲染 + 每块「查看原文」切换；
 *  - 真增量②：pre[data-context-text] 上下文注入块按 markdown 渲染
 *    （宿主 ContextBody 把它渲染为纯文本）；
 *  - 真增量③：整段 markdown 复制按钮（官方只有代码块复制）；
 *  - 真增量④：统一 MarkdownView 导出（供本仓其它插件使用）；
 *  - 真增量⑤：设置 → 插件 → 渲染 开关面板；
 *  - 真增量⑥（容错子集）：官方 GFM 不认的两种分隔行写法（无管道符 /
 *    列数与表头不等）先规范化再交给官方渲染（table-normalize.part）。
 * 注入渲染走 react-dom/client 的 createRoot（与 dsh-mermaid-render 同一
 * 手法），只把官方组件挂到本插件插入的容器里。
 *
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 把 lib/parts/*.part.js
 * 片段注入到下方 /*__PART_*__* / 占位符处并写出 lib/client.js（DSH 实际提供的
 * 产物，单一 __ModuleLoader__ bundle，无相对路径 require）。产物必须提交
 * （CI 只跑 node --check + 测试，不跑构建）；片段为纯函数声明文本（无
 * import/export），注入后处于本 factory 作用域。
 */
window.__ModuleLoader__.load({
  id: 'dsh-md-render',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // MarkdownView（markdown-view.part.js）与 CopyButton（copy.part.js）用
    // createElement / useState；设置页（settings.part.js）用 useEffect；
    // 注入渲染经 official-view.part.js 的 require 取平台模块。
    const { createElement, useState, useEffect } = require('react')

    // ── 渲染配置：保留增强功能的开关状态 ────────────────────────────
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

    // ── 扫描器骨架（共享）+ MutationObserver 跟随流式渲染 ───────────
    /*__PART_DOM_SCANNER__*/
    /*__PART_SCANNER__*/

    // ── 样式（DSH 语义 token，随 activation 注入）──────────────────
    /*__PART_STYLES__*/

    // ── 共享样式注入（dsh-shared/client-parts）──────────────────────
    /*__PART_STYLE_TAG__*/

    // ── 设置页：渲染增强开关可视化 + 保存 ───────────────────────────
    /*__PART_SETTINGS__*/

    // ── 插件入口：样式注入 + 扫描器装配 ───────────────────────────
    /*__PART_APPLY__*/

    return module.exports
  },
})
