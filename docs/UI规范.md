---
title: UI 规范
description: 插件 UI 统一规范（issue #54）— 视觉基准（dsh-file-activity）、共享图标系统、样式前缀、状态与交互规范、与 CI 的关系
created: 2026-08-28
updated: 2026-08-28
---

# UI 规范

> ⚠️ **何时阅读：** 开发/翻新任何插件的 client 端 UI 前必读（issue #54「UI 全面翻新」阶段 0 产出）。
>
> 💡 **优先使用官方 UI 组件库**（`@deepseek-ai/dsh-client-ui-primitives`，require 即用、零打包）——组件 API 与踩坑见 [官方 UI 组件库](开发指南/官方UI组件库.md)；本文规范自研部分（共享图标 / 样式前缀 / 状态交互）与官方组件配套使用。

## 概述

issue #54 要求以 **dsh-file-activity** 为视觉基准翻新其余 10 个插件的 UI。本规范固化阶段 0 建立的基础设施与设计语言：

- **视觉基准**：dsh-file-activity 的完整设计语言（线性图标 + 文件类型品牌色徽章 + 树形层级 + 空状态 + 图标按钮）；
- **共享图标系统**：单一来源的共享 parts（`plugins/dsh-shared/client-parts/`），所有插件构建时拼接；
- **样式前缀规范**：统一 `dsh-<插件名>-` 前缀，消除 `dso-`/`dmr-` 等跨插件冲突；
- **状态与交互规范**：loading / 空 / 错误 / 禁用态、开关组件、hover/active/transition、操作反馈；
- **与 CI 的关系**：构建产物必须提交、测试覆盖要求。

## 视觉基准（dsh-file-activity 设计语言）

dsh-file-activity 的 UI 语言由五个要素构成，翻新插件时逐项对齐：

| 要素         | 说明                                                                                                       | 参考实现                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 线性图标     | `stroke=currentColor` 描边图标（strokeWidth 1.8、viewBox 24×24、round 端点），继承周围文字色，明暗主题通吃 | `plugins/dsh-shared/client-parts/icons.part.js`                                                             |
| 文件类型徽章 | 品牌色圆角矩形 + 对比色短标记（如 JS/TS/PY/PDF），未映射扩展名回退中性 file 图标                           | 同上（`FILE_BADGES` / `badgeIcon` / `fileIconByExt`）                                                       |
| 树形层级     | 目录行粗体 + 品牌色强调、文件行常规 + 次级色；折叠箭头（chevron）指示展开态；单链目录压缩为点分路径        | `plugins/dsh-file-activity/lib/parts/tree.part.js`、`styles.part.js` 的 `.dfa-row-dir` / `.dfa-icon-folder` |
| 空状态       | 主文案 + 次级 hint 两行提示（如「暂无文件活动记录」+ 操作引导），次级色/弱化色                             | `styles.part.js` 的 `.dfa-empty` / `.dfa-empty-hint`                                                        |
| 图标按钮     | 24×24 圆形透明按钮（xs 20×20），hover 填充背景 + 主色文字，危险操作 hover 变红，禁用 40% 透明度            | `styles.part.js` 的 `.dfa-iconbtn` / `.dfa-iconbtn-danger` / `.dfa-iconbtn-xs`                              |

## 共享图标系统

### 位置与机制

- 共享 parts 位于 **`plugins/dsh-shared/client-parts/`**（当前仅 `icons.part.js`）。
- dsh-shared 已是 11 个插件依赖的共享包；client-parts 是**构建时源文件**，由各插件 `scripts/build.mjs` 直接按文件系统路径读取拼接，**不经过 package exports / require 解析**——因此**不需要**改 dsh-shared 的 `package.json` exports（`plugins/dsh-shared/package.json` 的 exports 只服务运行时 import）。
- parts 仍是纯函数声明文本（无 import/export），共享 factory 作用域，与各插件本地 parts 完全同构——DSH 浏览器 ModuleLoader 不支持相对路径 require，client 端必须单 bundle，拼接机制不变。

### 图标清单（17 个）

全部为 `stroke=currentColor` 线性图标，`icon.<name>(size)` 调用，默认尺寸见括号：

| 图标   | 名称           | 默认尺寸 | 用途                        |
| ------ | -------------- | -------- | --------------------------- |
| 时钟   | `clock`        | 16       | 时间/历史                   |
| 刷新   | `refresh`      | 16       | 刷新/更新检查               |
| 垃圾桶 | `trash`        | 16       | 删除/清空/卸载              |
| 右箭头 | `chevronRight` | 14       | 折叠态指示                  |
| 下箭头 | `chevronDown`  | 14       | 展开态指示                  |
| 文件   | `file`         | 16       | 中性文件图标（徽章回退）    |
| 文件夹 | `folder`       | 16       | 目录                        |
| 外链   | `external`     | 15       | 打开外部/新窗口             |
| 关闭   | `close`        | 15       | 取消/关闭/×                 |
| 问号   | `help`         | 16       | 询问/帮助（issue #54 新增） |
| 对勾   | `check`        | 16       | 保存/确认（issue #54 新增） |
| 加号   | `plus`         | 16       | 添加/安装（issue #54 新增） |
| 放大镜 | `search`       | 16       | 搜索（issue #54 新增）      |
| 齿轮   | `settings`     | 16       | 设置入口（issue #54 新增）  |
| 铅笔   | `pencil`       | 15       | 编辑（issue #54 新增）      |
| 警告   | `alert`        | 16       | 告警/警告（issue #54 新增） |
| 代码   | `code`         | 16       | 代码/源码（issue #54 新增） |

> 新增图标按需补充（如 `alert` 警告、`pencil` 编辑），必须保持 stroke=currentColor 风格一致，并同步更新本清单与 `plugins/dsh-file-activity/test/icons-ext.mjs` 的覆盖。

### 构建接入步骤（其他插件阶段 1 接入）

1. 在插件 `scripts/build.mjs` 的 `pieces` 中，把图标条目改为带 `shared: true` 标记：

   ```js
   // 改前
   ['__PART_ICONS__', 'icons.part.js'],
   // 改后
   ['__PART_ICONS__', 'icons.part.js', { shared: true }],
   ```

2. 删除插件本地 `lib/parts/icons.part.js`（如有），确保单一来源、不漂移。
3. 重新构建并提交产物：`cd plugins/<插件名> && npm run build`（产物 `lib/client.js` 必须提交，见 [与 CI 的关系](#与-ci-的关系)）。
4. 若插件测试直接读取 parts 源码（如 dsh-file-activity 的 `test/icons-ext.mjs`），把读取路径改为 `../../dsh-shared/client-parts/icons.part.js`。

> 构建脚本读取共享目录的路径约定：`join(root, '..', 'dsh-shared', 'client-parts')`（root 为插件目录），见 `plugins/dsh-file-activity/scripts/build.mjs` 的 `sharedPartsDir`。

## 样式前缀规范

### 前缀规则

- 所有插件统一使用 **`dsh-<插件名>-`** 前缀（插件名去掉 `dsh-` 前缀后的小写短名）：
  - dsh-my-memory → `dsh-my-memory-`（如 `dsh-my-memory-btn-save`）
  - dsh-my-plugin-manager → `dsh-my-plugin-manager-`
  - dsh-my-guardian → `dsh-my-guardian-`（现状已符合）
- **dsh-file-activity 保留 `dfa-` 前缀**：其 UI 已稳定（v0.5.x、测试覆盖完整），改前缀会引发大规模回归且无收益；本规范只约束其余插件，`dfa-` 作为历史例外记录于此。
- **阶段 1 已消除的冲突（issue #54，2026-08 完成）**：`dso-`（observability/guard/context 共用）已拆分；`dmr-`（mermaid-render/md-render 共用）已拆分；`dmm-`/`dpm-`/`dsm-`/`dn-`/`dns-`/`dtr-`/`tzx-think*` 等缩写前缀已统一改为全名前缀。**例外**：契约类名 `tzx-md`/`tzx-p`/`tzx-table`（dsh-md-render 表格增强跨插件依赖）、`md-code-block`/`md-table-wide`（渲染契约）、`dfa-`（历史例外）保留；新插件一律使用全名前缀。

### 类名命名规则

- 根容器：`<前缀>root`（如 `dsh-my-memory-root`）。
- 区块：`<前缀>section` / `<前缀>section-head` / `<前缀>section-title`。
- 元素：`<前缀><元素名>`（如 `-row`、`-name`、`-desc`、`-meta`、`-actions`、`-empty`、`-error`、`-hint`、`-note`、`-status`）。
- 变体：`<前缀><元素名>-<变体>`（如 `-btn-save`、`-btn-danger`、`-row-dir`、`-icon-folder`）。
- 状态：`<前缀><元素名>-<状态>`（如 `-saved`、`-new`、`-loading`）。
- 禁止：无前缀裸类名、跨插件共用类名、CSS-modules 哈希类名（宿主侧除外，见 dsh-file-activity `styles.part.js` 的 `[class*="tabActive"]` 回退契约）。

### CSS 变量（DSH 语义 token）

所有颜色/字体/动效一律走 DSH 语义 token，**禁止硬编码色值**（品牌徽章色除外，见 FILE_BADGES）。dsh-file-activity 已用 token 全集：

| 类别 | Token                                                                                                               | 用途                |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 文字 | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` / `-dimmed`                                                | 主/次/弱/更弱文字   |
| 交互 | `--dsw-alias-interactive-bg-hover`                                                                                  | hover 填充背景      |
| 状态 | `--dsw-alias-state-success-primary` / `-warn-primary` / `-danger-primary` / `-error-primary`                        | 成功/警告/危险/错误 |
| 品牌 | `--dsw-alias-accent`、`--dsw-alias-state-business-primary`                                                          | 强调色/选中态       |
| 表面 | `--dsw-alias-bg-layer-2`、`--dsw-alias-border-l1` / `-l2`                                                           | 浮层背景/描边       |
| 字体 | `--dsw-font-s-14`、`--dsw-font-s-strong-14`、`--dsw-font-xxs-12`、`--dsw-font-xxxs-11`、`--dsw-font-xxxs-strong-11` | 字号角色（见下）    |
| 阴影 | `--dsw-shadow-lv2`                                                                                                  | 浮窗阴影            |
| 动效 | `--ds-transition-duration-slow`、`--ds-ease-in-out`                                                                 | 过渡时长/缓动       |

### 数值规范（从 dsh-file-activity 提取）

| 维度     | 规范值                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 字号     | 14px（正文 `--dsw-font-s-14`）/ 12px（次级 `--dsw-font-xxs-12`）/ 11px（弱化与徽标 `--dsw-font-xxxs-11`，标题类用 strong 变体）      |
| 间距     | 页面 padding `2px 6px 8px`；元素 gap 2px（图标按钮组）/ 6px（行内）/ 8px（区块头）；区块 margin-top 4px                              |
| 圆角     | 4px（徽标/计数/操作标签）/ 6px（内嵌 frame）/ 8px（行）/ 10px（浮窗）                                                                |
| 行高     | 列表行 min-height 26px（better-sidebar 基准 30px 行内紧凑场景）                                                                      |
| 图标按钮 | 24×24 圆形（xs 20×20），图标 14–16px                                                                                                 |
| 过渡     | `transition: background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color ...`；入场动画 150ms `var(--ds-ease-in-out)` |

## 状态规范

| 状态    | 视觉要求                                                                           | 文案要求                                      |
| ------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| loading | 次级色文字或占位，不阻塞布局                                                       | 「加载中…」/「Loading…」                      |
| 空      | 主文案（次级色）+ 可选 hint（弱化色，`line-height 1.7`），两行结构                 | 说明「暂无 X」+ 引导「如何产生数据/如何操作」 |
| 错误    | 错误色（`--dsw-alias-state-error-primary`）文字，可换行（`white-space: pre-wrap`） | 说明失败原因，可操作时给出重试入口            |
| 禁用    | `opacity: .4` + `cursor: default`，不响应 hover                                    | 保持原文案，不额外解释                        |

## 交互规范

### 开关组件

- 设置类布尔项**必须用开关组件**（`<button role="switch">` + `aria-checked`，或宿主提供的 switch），**禁止**原生 checkbox 与「开/关」文字按钮。
- 开关轨道/滑块用语义 token 着色：开 = `--dsw-alias-state-success-primary`（或品牌色），关 = 中性表面色；过渡走 `--ds-transition-duration-slow`。
- 参考：dsh-my-notify 的 `dns-toggle`（阶段 1 翻新为统一开关样式）。

### hover / active / transition

- 可点击元素必须有 hover 反馈：图标按钮/行 hover 填充 `--dsw-alias-interactive-bg-hover`，文字色升一级（secondary → primary）。
- 危险操作（删除/清空/卸载）hover 变 `--dsw-alias-state-danger-primary`。
- 所有状态切换（hover/active/选中）必须带 transition（`--ds-transition-duration-slow` + `--ds-ease-in-out`），禁止无过渡跳变。
- 列表行入场动画 150ms（参考 `dfa-row-in` keyframes）。

### 操作反馈

- 写操作（保存/添加/删除/安装/卸载）完成后必须给出反馈：成功提示（绿色 `-saved` 状态条）或错误提示（错误色），禁止静默成功。
- 破坏性操作（清空/删除）必须二次确认：优先内联确认面板（参考 dsh-my-memory 的 `ConfirmPanel`：删除红色、保存绿色），**禁止**原生 `confirm()`。
- 图标按钮必须带 `aria-label`（如 `aria-label={strings.refresh()}`），纯图标无文字时无障碍必需。

## 与 CI 的关系

- **构建产物必须提交**：`lib/client.js` 由 `scripts/build.mjs` 拼接生成，是 DSH 实际服务的文件；CI 只对产物跑 `node --check` + 测试，**不重新构建**——改 parts/模板后必须本地 `npm run build` 并提交产物，否则 CI 检查的是过期产物。
- 产物被 `.prettierignore` 忽略（`plugins/*/lib/client.js`），prettier 只格式化 `client.src.js` 模板与 parts 源码；产物格式由构建脚本决定，无需手工格式化。
- **测试覆盖要求**：共享 parts 的改动必须有测试断言。参考 `plugins/dsh-file-activity/test/icons-ext.mjs`（直接读取共享 parts 源码 eval 断言元素树）——新增图标/徽章必须同步补测试；插件翻新后其 `npm test`（vitest + cucumber）必须全过。
- 全量校验：`node scripts/verify-local.mjs`（对齐 CI 全部门禁，见 `docs/开发指南/构建与测试.md`）。
