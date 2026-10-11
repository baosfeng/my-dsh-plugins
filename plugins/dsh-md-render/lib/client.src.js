/**
 * dsh-md-render — client half (browser)。职责边界：**只做 markdown 内容的渲染**（markdown
 * 文本 / 代码样式 / 图表渲染 / 思考 markdown），其他一律保持官方默认样式。
 * **内容渲染完全用插件自己的实现**（marked 解析 + 自研 vdom 渲染 + highlight.js 高亮），
 * 不再调用官方 MarkdownText / CodeBlock；解析层与高亮层走 assets 懒加载，不进本 bundle。
 * 注入点与能力清单见 README.md / docs/md渲染/，此处不重复。
 *
 * 硬约束（可机器校验，见 test/static-assertions.mjs）：
 *  - **不注册任何 conversation.chat.node 节点级 seat**（尤其 assistant-step）；
 *  - **不对官方元素写 style / class / aria**：DOM 注入只用自有 CSS + 自有 data-* 标记；
 *  - **不读 React fiber 私有属性**（__reactFiber$）；
 *  - 单 MutationObserver（一个扫描器按语言分流）。
 *
 * 外观是**插件自己的视觉语言**（src/client/parts/styles.ts 的 --mdr-* 自有 token：胶囊标签 /
 * 强调竖条 / 自有排版尺度与语法配色），颜色仍取宿主 --dsw-* 语义变量随深浅色自适应；
 * 随 activation 注入、fiber teardown 卸载（HMR / 禁用无残留）。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 把编译后的片段注入到下方
 * /*__PART_*__* / 占位符处并写出 lib/client.js（DSH 实际提供的产物，单一 __ModuleLoader__
 * bundle，无相对路径 require）。产物必须提交（CI 只跑 node --check + 测试，不跑构建）；
 * 片段为纯函数声明文本（无 import/export），注入后处于本 factory 作用域。
 */
window.__ModuleLoader__.load({
  id: 'dsh-md-render',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // createElement / hooks 由 react 提供；自有渲染经 dom-root.part 取平台 react-dom/client。
    const { createElement, useState, useEffect } = require('react')

    // 路由路径（构建期由 host 半 lib/routes/paths.js 注入的单一真源）
    /*__ROUTE_PATHS__*/
    // 渲染配置（三段开关 + 旧扁平键兼容）+ 围栏语言索引（issue #466）
    /*__PART_CONFIG__*/
    /*__PART_BLOCK_LANG__*/
    /*__PART_LANG_SOURCE__*/
    // 非标准表格容错（官方 GFM 未覆盖的两种写法）
    /*__PART_TABLE_NORMALIZE__*/
    // 渲染依赖懒加载：marked（解析层）/ highlight.js（高亮层），走 assets 静态路由
    /*__PART_RENDER_ASSETS__*/
    // 自有渲染容器的 React root 管理（不再 require 官方组件）
    /*__PART_DOM_ROOT__*/
    // 自研代码块渲染（hljs 高亮 + 真实语言名 banner + 复制 + 自动换行）
    /*__PART_OWN_CODE__*/
    // 自研 markdown 渲染（marked 词法树 → vdom，表格容错在此接上）
    /*__PART_OWN_MARKDOWN__*/
    // markdown 图片点击放大灯箱（原生 <dialog>，三路关闭）
    /*__PART_IMAGE_LIGHTBOX__*/
    // 整段 markdown 复制（官方只有代码块复制）
    /*__PART_COPY__*/
    // 统一 MarkdownView：对外公共 API（自研渲染 + 整段复制）
    /*__PART_MARKDOWN_VIEW__*/
    // 上下文注入块 markdown 渲染（pre[data-context-text]）
    /*__PART_CONTEXT_MARKDOWN__*/
    // 围栏块接管：markdown / 代码两路（mermaid 交给下面）
    /*__PART_BLOCK_RENDER__*/
    // 思考块默认展开（对官方折叠行派发一次 click；不改外观）
    /*__PART_THINK__*/
    // mermaid 引擎按需加载 + 离屏渲染
    /*__PART_MERMAID_ENGINE__*/
    // mermaid 图表卡片（预览 / 代码切换、导出、失败回显源码）
    /*__PART_MERMAID_CARD__*/
    // mermaid 代码块识别 + 流式稳定窗口
    /*__PART_MERMAID_SCAN__*/
    // mermaid 图表导出（PNG / SVG 下载 + 复制源码）
    /*__PART_MERMAID_EXPORT__*/
    // mermaid 图表全屏 + 缩放 / 平移（panzoom 懒加载；失败切内置降级引擎）
    /*__PART_ZOOM_MATH__*/
    /*__PART_ZOOM_FALLBACK__*/
    /*__PART_MERMAID_ZOOM__*/
    // 「渲染为…」语言手动切换（覆盖层 + 块内控件 + 卡片头并项）
    /*__PART_LANG_SWITCH__*/
    // 共享 DOM 扫描骨架 + 单 MutationObserver 按语言分流
    /*__PART_DOM_SCANNER__*/
    /*__PART_SCANNER__*/
    // 样式（DSH 语义 token，随 activation 注入）
    /*__PART_STYLES__*/
    // 共享样式注入 / 图标集（dsh-shared/client-parts）
    /*__PART_STYLE_TAG__*/
    /*__PART_ICONS__*/
    // 设置页：文案 / 样式（i18n）+ 三分组视图 + tab 注册（单 tab）
    /*__PART_SETTINGS_STRINGS__*/
    /*__PART_SETTINGS_VIEW__*/
    /*__PART_SETTINGS__*/
    // 插件入口：样式注入 + 扫描器装配 + 设置页
    /*__PART_APPLY__*/

    return module.exports
  },
})
