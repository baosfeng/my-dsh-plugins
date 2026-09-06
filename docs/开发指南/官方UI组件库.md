# 官方 UI 组件库（@deepseek-ai/dsh-client-ui-primitives）

> ⚠️ **何时阅读：** 翻新/开发任何插件 client UI 时——**优先使用官方 UI 组件库**，而不是自研组件或引入第三方框架（antd 等）。
> 本文所有结论均经 **2026-09-04 本机隔离实例实证**（非猜测）。

## 结论（TL;DR）

1. **DSH 官方自带 UI 组件库**：`@deepseek-ai/dsh-client-ui-primitives`（官方仓库 `packages/client/ui-primitives`，npm 已发布 `0.0.1-rc.x`，描述："Pure React atoms for the dsh web UI: controls, icons, markdown, and JSON inspectors (zero cordis)"）。
2. **插件 client 可直接 `require` 使用，零安装、零打包、零体积**：宿主把它注册进 ModuleLoader 的 **staticModules 静态模块表**（主 bundle `staticModules: Jd()` 显式暴露 `react` / `react/jsx-runtime` / `react-dom` / `@deepseek-ai/cordis` / `@deepseek-ai/dsh-client-ui-slots` / `@deepseek-ai/dsh-client-ui-primitives`），插件 factory 的 `require` 直接命中该表。
3. **生态已实证**：社区最流行插件 [DSH-Transparent-UI-Plugin](https://github.com/WYH66666666/DSH-Transparent-UI-Plugin)（401★）的 client 就是 `require("@deepseek-ai/dsh-client-ui-primitives")` 构建的。
4. **本机实测**：在隔离实例的 dsh-my-memory 插件 client factory 顶层 `require('@deepseek-ai/dsh-client-ui-primitives')` → **解析成功，拿到 104 个导出**，页面正常加载（实验代码已验证后还原）。

## 组件清单（导出实证，共 104 项）

- **控件**：`Button` `Input` `Menu` `Modal` `Pill` `DisclosureRow` `HoverCard` `StateDot` `FoldToggle` `OnboardingSurface` `ConnectionIndicator`
- **内容/展示**：`CodeBlock` `JsonTree` `JsonBlock` `MarkdownText` `MessageText` `ReadBlock` `SearchBlock` `TerminalBlock` `WebBlock` `DiffBlock` `RiskConfirmation`
- **反馈**：`Toast` `Tooltip`
- **品牌**：`BrandWordmark` `FishLogo` `DocumentFileIcon`
- **图标（50+ 线性）**：`IconChevronDownOutline14` `IconCheckOutline16` `IconRefreshOutline14` `IconTrashOutline16` `IconCloseOutline16` `IconEditOutline16` `IconSearchOutline16` `IconSettingsOutline14` `IconWarningOutline16` `IconThinkOutline14` 等（命名规则 `Icon<名称><Outline|Fill><尺寸>`）
- **hooks/工具**：`useAnchoredPosition` `useAnchoredMaxHeight` `useDismissOnOutsidePointer` `writeClipboard` `extractMarkdownPlainText` `DEFAULT_*_MAX_LINES`

组件 API 为标准 React 函数组件（antd 式形态）。例（官方源码实测）：

```js
// Pill: active 选中态；有 onClick 渲染为 button，否则 static span
createElement(uiPrimitives.Pill, { active: true, onClick: handler }, '文本')
```

### 试点实证的 API 用法（issue #143：dsh-my-memory / dsh-my-skill-manager 已落地）

```js
// Button：variant（primary/ghost/outline/toolbar）+ size（sm 适配侧边栏）+ icon
createElement(
  ui.Button,
  { variant: 'outline', size: 'sm', onClick: retry, icon: createElement(ui.IconRefreshOutline14) },
  '重试',
)

// Input：className 在 wrapper，原生属性（value/onChange/placeholder）在内部 input
createElement(ui.Input, { className: 'dsh-my-memory-input', value, onChange, placeholder })

// Pill：徽标/分段控制（active 选中态；onClick 渲染为 button）
createElement(ui.Pill, { active: scope === 'global', onClick: () => setScope('global') }, '全局')

// 图标：命名规则 Icon<名称><Outline|Fill><尺寸>，props 透传（className 可加旋转等）
createElement(ui.IconRefreshOutline14, { className: loading ? 'spin' : undefined })
```

- 测试 stub：client-render / client-session 测试中 stub 官方组件库（`if (spec === '@deepseek-ai/dsh-client-ui-primitives') return uiPrimitives`），stub 组件带 `data-ui` 标记供「官方组件被使用」断言（见 dsh-my-memory/test/client-render.mjs）。
- eslint：`import/no-unresolved` 需将 `@deepseek-ai/dsh-client-ui-primitives` 加入 ignore（staticModules 注入，node_modules 无对应包，见 eslint.config.js）。

## 插件内使用方式

```js
// client factory 内（无需改构建，无需 package.json 声明）
const uiPrimitives = require('@deepseek-ai/dsh-client-ui-primitives')
```

- **不需要** `dsh.client.inject` 声明（staticModules 全局提供；`inject` 仍是 跨插件 bundle（如 `require('dsh-md-render')` 走 `dsh.client.external`）的机制）。
- 样式跟随 DSH 主题 token（`--dsw-alias-*`），深浅主题自适应；需覆写时用我们既有的 `<插件>-*` 前缀类名 + DSH token（见 [UI规范.md](../UI规范.md)）。

## 与其他方案的对比

| 方案                                  | 判定                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **官方 ui-primitives**                | ✅ 首选：零引入、零打包、require 即用、视觉与 DSH 原生 100% 同源                                          |
| ant-design                            | ❌ 不可行：拼接单 bundle + ModuleLoader 无法解析 antd 依赖图；esbuild 硬打包则每插件 200-500KB 且风格冲突 |
| 自研 dsh-ui 组件包                    | 降级为补充：只补官方没有的控件（如自定义确认面板 / 专用表单项）                                           |
| dsh-shared/client-parts（构建期拼接） | 保留：图标（icons.part.js）/ 碎片复用 / 样式规范                                                          |

## 踩坑记录

- **不存在 `moduleName` 方案**：ModuleLoader 顶层 `window.__ModuleLoader__.load()` 是 bootstrap 外壳，其 `factory` 的 require 不解析 staticModules（实测 `require('@deepseek-ai/dsh-client-ui-primitives')` 在顶层 load 里失败）；**必须在正常插件 bundle（经 cordis-client-runner 加载的插件 client）中 require**。
- **官方 client 模块不是独立 `/plugins/.../client.js` 资源**：ui-primitives 编译进主 bundle（network 里看不到它的独立请求，但模块表存在）——不要用 network 排查它是否可用。
- 官方 client 包（`dsh-client-ui-*`）与插件的是同一个 ModuleLoader：插件页签/面板能渲染即证明模块表就绪。
