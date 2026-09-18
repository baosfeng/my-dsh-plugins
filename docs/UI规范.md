---
title: UI 规范
description: 插件 UI 统一规范 — 视觉基准、共享图标系统、样式前缀、token 与数值、状态与交互要求
---

# UI 规范

> ⚠️ **何时阅读：** 开发/翻新任何插件的 client 端 UI 前必读。
>
> 💡 **优先使用官方 UI 组件库**（`@deepseek-ai/dsh-client-ui-primitives`，require 即用、零打包）——组件 API 与踩坑见 [官方 UI 组件库](开发指南/官方UI组件库.md)；本文约束自研部分（共享图标 / 样式前缀 / 状态交互），与官方组件配套使用。

## 视觉基准（dsh-file-activity 设计语言）

翻新插件时逐项对齐：

| 要素         | 要求                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| 线性图标     | `stroke=currentColor` 描边图标（strokeWidth 1.8、viewBox 24×24、round 端点），继承文字色，明暗主题通吃 |
| 文件类型徽章 | 品牌色圆角矩形 + 对比色短标记，未映射扩展名回退中性 file 图标                                          |
| 树形层级     | 目录行粗体 + 品牌色强调、文件行常规 + 次级色；chevron 指示展开态；单链目录压缩为点分路径               |
| 空状态       | 主文案 + 次级 hint 两行提示                                                                            |
| 图标按钮     | 24×24 圆形透明按钮（xs 20×20），hover 填充背景 + 主色文字，危险操作 hover 变红，禁用 40% 透明度        |

## 共享图标系统

- 单一来源：`plugins/dsh-shared/client-parts/`（`icons.part.js` 线性图标 + 文件类型徽章映射、`style-tag.part.js` 样式注入、`dom-scanner.part.js` MutationObserver 骨架、`markdown-fallback.part.js` 渲染三级回退）。各插件构建时按文件系统路径读取并拼接，**不经过 package exports / require 解析**，因此**不需要**改 dsh-shared 的 `package.json` exports。
- parts 是纯函数声明文本（无 import/export），共享 factory 作用域，与插件本地 parts 同构（ModuleLoader 不支持相对路径 require，client 端必须单 bundle）。
- **共享的边界**：只抽逐字或结构等价的骨架；插件特有行为（流式门控、幂等签名、围栏闭合判定、离屏渲染、teardown 清理）通过参数/回调注入，**不因归一而削功能**。差异过大时宁可只抽骨架，也不做"为归一而削能力"的抽象。
- 注入校验：占位符「恰好一处 + 非注释位置 + 锚点声明恰好一份」三道断言在 `plugins/dsh-shared/scripts/splice.mjs`，各插件 `scripts/build.mjs` 直接 import。
- **增长会放大到所有消费方**：改一次 `icons.part.js`，所有消费方 `lib/client.js` 同时变大——改完跑 `node scripts/check-client-size.mjs`（或 `npm run verify`）确认没顶破体积预算，口径见 [构建与测试](开发指南/构建与测试.md)。
- **改了共享部件必须重建并提交所有消费方产物**：产物 `lib/client.js` 必须提交（CI 不跑构建），漏重建会静默陈旧。`node scripts/check-client-artifacts.mjs`（已接入 verify-local 与 CI quality job）会重建全部消费方产物与已提交版本逐字节比对，不一致即失败并点名插件与共享件；它也覆盖各插件 server 端 tsc 产物的同类陈旧。该门禁对工作区**只读**（重建在仓库外的 HEAD 镜像里进行），与并发 `prettier --check` 不冲突。
- 新增共享部件时沿用上述三道断言，并补产物级测试（"片段逐字节出现在产物里" + "锚点声明恰好一份"）。

## 样式前缀规范

- 所有插件统一 **`dsh-<插件名>-`**（如 `dsh-my-memory-btn-save`）。**例外**：`dsh-file-activity` 保留 `dfa-`（UI 已稳定，改前缀等于大规模回归无收益）；契约类名 `tzx-md` / `md-code-block` / `md-table-wide` 等跨插件依赖保留。新插件一律用全名前缀。
- 类名结构：根容器 `<前缀>root`；区块 `<前缀>section` / `-section-head` / `-section-title`；元素 `<前缀><元素名>`（`-row` `-name` `-desc` `-meta` `-actions` `-empty` `-error` `-hint` `-status` …）；变体 `<元素名>-<变体>`（`-btn-danger` `-row-dir` `-icon-folder`）；状态 `<元素名>-<状态>`（`-saved` `-loading`）。
- **禁止**无前缀裸类名、跨插件共用类名、CSS-modules 哈希类名（宿主侧除外）。

## CSS 变量（DSH 语义 token）

所有颜色/字体/动效一律走 token，**禁止硬编码色值**（品牌徽章色除外）：

| 类别        | Token                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| 文字        | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` / `-dimmed`                                    |
| 交互        | `--dsw-alias-interactive-bg-hover`                                                                      |
| 状态        | `--dsw-alias-state-success-primary` / `-warn-primary` / `-danger-primary` / `-error-primary`            |
| 品牌        | `--dsw-alias-accent`、`--dsw-alias-state-business-primary`                                              |
| 表面        | `--dsw-alias-bg-layer-2`、`--dsw-alias-border-l1` / `-l2`                                               |
| 字体        | `--dsw-font-s-14`、`--dsw-font-s-strong-14`、`--dsw-font-xxs-12`、`--dsw-font-xxxs-11`（+ strong 变体） |
| 阴影 / 动效 | `--dsw-shadow-lv2`、`--ds-transition-duration-slow`、`--ds-ease-in-out`                                 |

**数值**：字号 14px（正文）/ 12px（次级）/ 11px（弱化与徽标）；间距页面 padding `2px 6px 8px`、元素 gap 2px（图标按钮组）/ 6px（行内）/ 8px（区块头）；圆角 4px（徽标）/ 6px（内嵌 frame）/ 8px（行）/ 10px（浮窗）；列表行 min-height 26px；图标按钮 24×24（xs 20×20）配 14–16px 图标；过渡 `background/color` 走 `--ds-transition-duration-slow` + `--ds-ease-in-out`，入场动画 150ms。

## 状态规范

| 状态    | 视觉要求                                                         | 文案要求                             |
| ------- | ---------------------------------------------------------------- | ------------------------------------ |
| loading | 次级色文字或占位，不阻塞布局                                     | 「加载中…」                          |
| 空      | 主文案（次级色）+ 可选 hint（弱化色，line-height 1.7），两行结构 | 说明「暂无 X」+ 引导「如何产生数据」 |
| 错误    | 错误色文字，可换行（`white-space: pre-wrap`）                    | 说明失败原因，可操作时给重试入口     |
| 禁用    | `opacity: .4` + `cursor: default`，不响应 hover                  | 保持原文案，不额外解释               |

## 文案与国际化

- **按当前语言返回单语**，禁止「中文 / English」并排写在同一段（实测：并排把设置行 hint 撑到 4 行、把开关架空，且与走了 i18n 的插件表现不一致）。
- 文案取值必须是 **惰性函数**（`() => string`）：宿主靠重注册跟随语言切换，硬编码字符串切语言后不会更新（`slots.register` 的 `label` 尤其如此）。
- 语言判据沿用既有实现：`plugins/*/src/client/parts/i18n.ts` 的 `navigator.language` 前缀判 `zh`，try/catch 兜底英文；能读到 `<html lang>`（宿主 locale 写入）时优先它，避免"浏览器英文 + 宿主中文"错配。
- 与**插件自身的 DOM 词表替换**冲突时（如 `dsh-think-zh-expand` 的 `Thinking → 思考`）不要直接使用会被改写的全等英文串，改选不被词表命中的措辞，并用测试钉死（`enLabel !== 'Thinking'`）。

## 交互规范

- **开关组件**：设置类布尔项必须用 `<button role="switch">` + `aria-checked`（或宿主提供的 switch），**禁止**原生 checkbox 与"开/关"文字按钮；开 = `--dsw-alias-state-success-primary`（或品牌色），关 = 中性表面色，过渡走 `--ds-transition-duration-slow`。
- **hover / active**：可点击元素必须有 hover 反馈（图标按钮/行填充 `--dsw-alias-interactive-bg-hover`，文字色升一级）；危险操作 hover 变 `--dsw-alias-state-danger-primary`；所有状态切换必须带 transition，禁止无过渡跳变。
- **操作反馈**：写操作（保存/添加/删除/安装/卸载）完成后必须给出成功或错误提示，禁止静默成功。
- **破坏性操作**（清空/删除）必须二次确认，优先内联确认面板，**禁止**原生 `confirm()`。
- 图标按钮必须带 `aria-label`（纯图标无文字时无障碍必需）。

## 与 CI 的关系

- **构建产物必须提交**：`lib/client.js` 是 DSH 实际服务的文件，CI 只对产物跑 `node --check` + 测试、**不重新构建**——改 parts/模板后必须本地 `npm run build` 并提交产物，否则 CI 检查的是过期产物。
- 产物被 `.prettierignore` 忽略（格式由构建脚本决定，无需手工格式化），prettier 只格式化模板与 parts 源码。
- **测试覆盖**：共享 parts 的改动必须有测试断言（如 `plugins/dsh-file-activity/test/icons-ext.mjs` 直接读取共享 parts 源码断言元素树）；新增图标/徽章必须同步补测试，插件翻新后其 `npm test` 必须全过。
- 全量校验：`npm run verify`（对齐 CI 全部门禁，见 [构建与测试](开发指南/构建与测试.md)）。
