---
title: 官方 UI 组件库（集成契约）
description: @deepseek-ai/dsh-client-ui-primitives 的接入契约、staticModules 门禁副本、MarkdownText 兜底与踩坑
---

# 官方 UI 组件库（集成契约）

> ⚠️ **何时阅读：** 开发 / 翻新任何插件 client UI 时——**优先使用官方 UI 组件库**，而不是自研组件或引入第三方框架（antd 等）。
> **组件形态清单与 props 不在这里查**——直接读宿主包源码（本机运行包 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/` 内的 `@deepseek-ai/dsh-client-ui-primitives`）或官方参考源 `/Users/bsfeng/IdeaProjects/deepseek-harness`；本文只记**接入契约与踩坑**。

## 接入契约

1. **插件 client 直接 `require` 即可用：零安装、零打包、零体积**。宿主把它注册进 ModuleLoader 的 **staticModules 静态模块表**（与 `react` / `react-dom` / `@deepseek-ai/cordis` / `dsh-client-ui-slots` 同表），插件 factory 的 `require` 直接命中。`require` 处**不需要** `dsh.client.inject` 声明（`inject` 仍是跨插件 bundle 的机制）。

```js
// client factory 内（无需改构建，无需 package.json 声明）
const ui = require('@deepseek-ai/dsh-client-ui-primitives')
```

2. 该表的**门禁副本**在 `scripts/check-client-modules.mjs` 的 `SEED_MODULES`：任何 `plugins/*/lib/client.js` 里 require 了既非该表、也非 `dsh.client.external` / 自身包名的模块，CI `quality` job 直接失败（用户机器上会抛 `client-modules: require("X") missed the module table`，整条 client factory 挂掉）。**新增 seed 模块时两处同步**。
3. 测试 stub：client-render 等测试里按模块名 stub 官方组件库，stub 组件带 `data-ui` 标记供「官方组件被使用」断言。
4. eslint：`import/no-unresolved` 需把该包加入 ignore（staticModules 注入，node_modules 无对应包）。
5. 样式跟随 DSH 主题 token（`--dsw-alias-*`），深浅主题自适应；需覆写时用自己 `<插件>-*` 前缀类名 + token（见 [UI 规范](../UI规范.md)）。
6. **不可行**：antd（拼接单 bundle + ModuleLoader 无法解析其依赖图，硬打包则每插件 200–500KB 且风格冲突）。自研组件包只作补充（补官方没有的控件）。

## `MarkdownText` 作为渲染兜底

`MarkdownText` 是官方 GFM + KaTeX 渲染组件，因此是「跨插件渲染内核缺失」时最合适的兜底：零安装、零体积、零 external 声明。

**props 契约**：`text`（Markdown 源文本，必填）；`labels: { code: { copyLabel, copiedLabel }, footnotes }` —— **必填且无默认值**，实现直接读 `labels.code.copyLabel`，不传即 TypeError（早期官方包的旧字段为 `codeLabels`，兼容期两个都传）；`streaming` / `fileMentions` / `pathImages` 可选。

**用共享部件，不要自己重写三级链**：`dsh-shared/client-parts/markdown-fallback.part.js` 的 `installMarkdownViewFallback({ require, createElement, labels, codeLabels, fallbackAttribute, fallbackClassName? })` 已实现 外部内核 → 宿主 `MarkdownText` → `<pre>` 三级回退（构建期 splice 进 factory 作用域，文案与 DOM 标记由消费方注入），新插件直接注入使用（ADR-0002：≥2 处重复即抽出）。

- **可用性判定必须按 React 语义**：`MarkdownText` 是 `React.memo(...)` 返回的**对象**（`typeof` 为 `'object'`），`typeof v === 'function'` 会把官方组件误判为不可用。判定用 `typeof v === 'function' || (typeof v === 'object' && v !== null && typeof v.$$typeof === 'symbol')`（`react` 的 `isValidElementType` 在当前宿主与 Node 侧 React 19 上都不再导出），并排除 `'div'` 这类宿主标签字符串。
- **仍保留三级链**：官方组件也可能不存在（极旧/裁剪宿主）→ 最后一级 `<pre data-<插件>-fallback="true">`。只有「真的换了渲染组件」才算降级；把组件变量置 `null` 而渲染路径没有 null 分支会在渲染期抛 `Element type is invalid … but got: null`（见[踩坑目录](../踩坑/README.md)「只 catch require 不等于优雅降级」）。
- **中文文案由插件提供**：`labels` 无默认值正好让中文化插件注入自己的文案；只渲染纯标题/段落时不会访问 `labels.code.copyLabel`，但契约上仍必须传（含代码块必崩）。
- **为什么不是替代 `dsh-md-render`**：官方缺 `dsh-md-render` 的增强集（非标准表格容错、`div.md-code-block` 容器——`dsh-mermaid-render` 靠它渲染图表、代码复制/高亮/行号/主题、公式结构排版、`.tzx-md` 与 `dsh-md-render-*` 契约类样式）。**`dsh-md-render` 仍是首选内核**：external 声明保留、装了就用它，官方组件仅在它缺失时兜底。

## 踩坑

- **不存在 `moduleName` 方案**：`window.__ModuleLoader__.load()` 顶层是 bootstrap 外壳，其 `factory` 里的 require **不解析 staticModules**——必须在正常插件 bundle（经 cordis-client-runner 加载的插件 client）中 require。
- **官方 client 模块不是独立 `/plugins/.../client.js` 资源**：ui-primitives 编译进主 bundle，network 里看不到它的独立请求，但模块表存在——不要用 network 排查它是否可用。
- 官方 client 包与插件共用同一个 ModuleLoader：插件页签/面板能渲染即证明模块表就绪。
