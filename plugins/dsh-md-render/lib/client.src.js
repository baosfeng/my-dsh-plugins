/**
 * dsh-md-render — client half (browser).
 *
 * 统一 Markdown 渲染插件（issue #31 渲染职责迁移）：
 *  - 提供统一 MarkdownView 组件（表格 / 公式 / 代码块容器），供
 *    dsh-think-zh-expand 的 assistant-step 渲染器调用（跨插件
 *    require，见其 package.json 的 dsh.client.external 声明）；
 *  - 代码块容器 `div.md-code-block` 由本插件产出（结构保持，
 *    dsh-mermaid-render 无需改动即可扫描）；
 *  - DOM 层表格增强：扫描 `[data-conversation-scroll]` 内的
 *    `div.tzx-md`（MarkdownView 输出）与 `div.md-table-wide`（内置
 *    MarkdownText 的宽表格容器）容器，对容器内以纯文本段落形式存在
 *    的表格（`p.tzx-p`），用增强检测规则（支持无首尾管道符、分隔行
 *    变体、对齐标记）识别并解析，将段落替换为 `<table>`（表头 thead /
 *    数据 tbody / 对齐 style），外层 `div.dsh-md-render-table-scroll`
 *    提供宽表格横向滚动 + 滚动提示条；已渲染的表格（`table.tzx-table`
 *    等）跳过，不重复处理；
 *  - MutationObserver 跟随流式渲染，流式中的容器等内容稳定后再处理。
 *
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 把
 * lib/parts/*.part.js 片段注入到下方 /*__PART_*__* / 占位符处并写出
 * lib/client.js（DSH 实际提供的产物，单一 __ModuleLoader__ bundle，无相对
 * 路径 require）。产物必须提交（CI 只跑 node --check + 测试，不跑构建）；
 * 片段为纯函数声明文本（无 import/export），注入后处于本 factory 作用域。
 */
window.__ModuleLoader__.load({
  id: 'dsh-md-render',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // MarkdownView（markdown.part.js 片段）使用 createElement；
    // CopyButton（issue #74 复制按钮）使用 useState；设置页
    // （settings.part.js，issue #84）使用 useEffect。
    const { createElement, useState, useEffect } = require('react')

    // ── 共享图标（dsh-shared/client-parts，issue #54 阶段 0）────────
    /*__PART_ICONS__*/

    // ── 渲染配置（issue #84）：增强开关状态 + setRenderOptions ──────
    /*__PART_CONFIG__*/

    // ── 复制按钮（issue #74）：CopyButton + 复制工具函数 ──────────
    /*__PART_COPY__*/

    // ── 代码块增强（issue #80）：tokenizer（语法高亮）────────────────
    /*__PART_HIGHLIGHT__*/

    // ── 代码块增强（issue #80）：语言标签 + 复制按钮头部 + 行号 ─────
    /*__PART_CODEBLOCK__*/

    // ── 公式结构（issue #82）：命令符号表 / 轻量解析器 / 结构渲染 ────
    /*__PART_MATH_SYMBOLS__*/
    /*__PART_MATH__*/
    /*__PART_MATH_RENDER__*/

    // ── 语法补全（issue #81）：图片 / 任务列表 / 行内元素构造 / 列表解析 ──
    /*__PART_SYNTAX__*/

    // ── 统一 MarkdownView：行内 + 块级渲染（导出供 think-zh-expand）──
    /*__PART_MARKDOWN__*/

    // ── 表格检测与解析（纯函数，导出供单测）──────────────────────
    /*__PART_DETECT__*/

    // ── 行内渲染：单元格内的 code / strong / em / link ─────────────
    /*__PART_INLINE__*/

    // ── DOM 表格渲染：div.dsh-md-render-table-scroll > table.dsh-md-render-table ──
    /*__PART_RENDER__*/

    // ── 上下文注入块 markdown 渲染（issue #196）────────────────────
    /*__PART_CONTEXT_MARKDOWN__*/

    // ── 轨迹视图 markdown 接管（issue #205）：DOM 渲染器 + 接管层 ───
    /*__PART_DOM_MARKDOWN__*/
    /*__PART_TRAJECTORY_MARKDOWN__*/

    // ── 扫描器：MutationObserver 跟随流式渲染 ──────────────────────
    /*__PART_SCANNER__*/

    // ── 样式（DSH 语义 token，随 activation 注入）──────────────────
    /*__PART_STYLES__*/

    // ── 设置页（issue #84）：渲染增强开关可视化 + 保存 ───────────────
    /*__PART_SETTINGS__*/

    // ── 插件入口：样式注入 + 扫描器装配 ───────────────────────────
    /*__PART_APPLY__*/

    return module.exports
  },
})
