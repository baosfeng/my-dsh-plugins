---
title: 假降级——只 catch require 不等于优雅降级
description: 依赖缺失时把组件置 null 却没换渲染分支，渲染期 createElement(null) 直接抛错（issue #290/#293 实例）
created: 2026-09-15
status: 已解决
---

# 假降级——只 catch require 不等于优雅降级

## 现象

`dsh-think-zh-expand@0.4.9` 声称「`dsh-md-render` 未安装时优雅降级为纯文本」（#290 的修复），实际**新装用户依旧整块思考/回复渲染崩溃**——崩溃点从 factory 加载期挪到了渲染期：

```
Error: Element type is invalid: expected a string (for built-in components)
or a class/function (for composite components) but got: null.
```

复现（本机 `test/client-render-fallback.mjs`，`createElement` 复刻 React 的元素类型不变量）：

```
 ❯ createElement test/client-render-fallback.mjs:31:50
 ❯ Object.ThinkBlock [as type] test/client-render-fallback.mjs:66:1
 Test Files  1 failed (1)   Tests  no tests
```

同一现象在真 React 下等价：`renderToStaticMarkup(createElement(null, { text: 'hello' }))` → 同一条 `Element type is invalid`。

## 根因

0.4.9 的 `lib/client.src.js`（#290 的修复）只做了「让 require 不抛」：

```js
let MarkdownView = null
try {
  MarkdownView = require('dsh-md-render').MarkdownView
} catch {
  MarkdownView = null // 注释写着「不可用时回退纯文本」
}
```

但渲染路径里没有任何 null 分支，仍是裸调用：`createElement(MarkdownView, { text })`（`src/client/index.ts:159-164`、`:190` → 产物 `lib/client.js`）。于是：

1. **try/catch 只覆盖了「取组件」**，没覆盖「用组件」——降级必须换掉**被渲染的东西**，而不是把组件变量置空；
2. **注释即幻觉**：`// 不可用时回退纯文本` 是愿望不是实现，读代码的人（和写代码的 agent）都会以为降级已生效；
3. **测试结构性缺位**：`test/client-render.mjs` **先** materialize `dsh-md-render` 再测，`dsh.client.external` 的「缺包」路径零覆盖，所以假降级一路绿到发版。

## 正确做法

**降级 = 真的提供替代渲染组件**，且每一级都要能落到下一级。`dsh-think-zh-expand@0.4.10`（issue #293）的三级链：

```js
// factory 顶层解析，最终仍绑定为 MarkdownView（TS 源码/编译产物零改动）
// 1) dsh-md-render.MarkdownView —— 装了就用（行为逐字节不变）
// 2) require('@deepseek-ai/dsh-client-ui-primitives').MarkdownText —— 宿主
//    staticModules 提供的官方 GFM + KaTeX 渲染（零安装零体积），须传 labels
//    （无默认值：实现直接读 labels.code.copyLabel）
// 3) (props) => createElement('pre', { 'data-dsh-think-zh-expand-fallback': 'true' }, props.text)
```

要点：

- **每一级都判「导出是不是可用组件」**：`require` 抛错 / 导出不是组件（null、undefined、空对象、字符串、组件位非组件）都必须安全跳过，落到下一级；
- **可用性判定必须按 React 语义**（同一坑的第二个形态，PR #295 review 抓出）：官方 `MarkdownText` 是 `React.memo(...)` 返回的**对象**（宿主 0.1.5-rc.1 实测 `object($$typeof,type,compare)`，`typeof` 是 `'object'`）——写成 `typeof v === 'function'` 会把官方组件误判为缺失、**直接落到 `<pre>`**：不再崩，但「官方组件渲染」这条验收标准没达成（等于白装）。正确写法是 `react.isValidElementType`（取不到时退化为 `typeof v === 'function' || (typeof v === 'object' && v !== null && typeof v.$$typeof === 'symbol')`），并排除宿主标签字符串。实测：宿主 shell 主 bundle（React 18.3.1）grep 不到 `isValidElementType`、仓库 CI 的 react 19.3.0 也已不再导出它 → 退化式才是实际生效路径，**两条路径都要有测试**；
- **兜底组件必须自带完整契约**：官方 `MarkdownText` 的 `labels` 无默认值（直接 `labels.code.copyLabel` → 不传即 TypeError；只在渲染含代码块的 markdown 时访问），跨版本还要兼容旧字段 `codeLabels`；
- **测试要覆盖「缺依赖」本身**：stub 的 `require` 对缺失包抛错，`createElement` 复刻 React 的元素类型不变量（含 memo/forwardRef 对象的展开方式），且**组件 stub 要用真实形态（memo 对象）**——否则纯结构 stub / 函数形态 stub 不会暴露误判，假降级照样绿；
- 优先用**宿主平台组件**兜底（`@deepseek-ai/dsh-client-ui-primitives`，见 [官方UI组件库](../开发指南/官方UI组件库.md)），而不是自研一套或直接退纯文本。

## 防复发

- `test/client-render-fallback.mjs`：md-render 缺失（官方组件可用 / **memo 对象形态** / 也缺失）+ 各级导出畸形矩阵 + 先红后绿（旧实现下 `Element type is invalid … but got: null`；`typeof === 'function'` 判定下 memo 用例落到 `<pre>`）（issue #293）；
- Gherkin 场景：`test/features/zh.feature`「未装 dsh-md-render 时用官方 MarkdownText 兜底」「md-render 与官方组件都缺失时回退纯文本」「官方组件是 memo 对象时仍用官方组件渲染」；
- 门禁侧缺口单独跟踪 **issue #294**：发版门禁 1c 补 `dsh.client.external` 校验（external 消费者必须有降级路径）、3c 真实环境验证补「external 缺包」场景（现状复用生产 profile 的 `node_modules`，本机装了 `dsh-md-render` → #290 场景结构性不可复现、假通过）。

→ [踩坑记录](README.md)
