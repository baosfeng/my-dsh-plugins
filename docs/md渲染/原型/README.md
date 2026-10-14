---
title: md 渲染 · 原型
description: dsh-md-render 的 markdown 渲染视觉原型 —— 自研渲染器全部元素做成一张样张（Apple 风格 token），含验证结论与过程指针
---

# md 渲染 · 原型（markdown 渲染样张）

> [模块文档](../概述.md) · [文档索引](../../索引.md) · 源码 `plugins/dsh-md-render/`

## 这是什么

把 dsh-md-render **自研 markdown 渲染器**产出的元素摆成一张样张，用 Apple 风格 token（`odops style apple` 的 56 槽 `:root`）打底，
深浅色都可看。**只覆盖 markdown 渲染**：不含宿主界面（会话列表 / 顶栏 / 侧栏）与其他渲染器（代码块卡片、mermaid 卡片、思考块、上下文注入块的外壳与控件）。

## 怎么看

```bash
open "docs/md渲染/原型/08-prototype.html"          # 交付件（单文件自包含，双击也行）
open "docs/md渲染/原型/08-prototype.html#dark"     # 深色态（也跟随系统 prefers-color-scheme）
```

可交互：任务框能勾、图片点开放大、整段 markdown 能复制（成功 / 失败都有反馈）、表格行 hover、锚点平滑滚动；
`prefers-reduced-motion` 下动效全关。

## 验证怎么跑

```bash
odops daemon start                                  # 官方 lint 走 daemon；不必开桌面应用
odops lint "docs/md渲染/原型/08-prototype.html" --fail-on p1
odops verify "docs/md渲染/原型/08-prototype.html" --template web-prototype --platform web --browser
odops daemon stop
```

实测结论：官方 anti-slop lint **clean — 0 findings**；`verify` 机械项全过（自包含 / 56 槽完整 / 零裸色值 /
区块 `data-od-id` / 断点 1440·1024·768 / 无横向溢出 / 对比度达标）；深色态两种入口文本对比度**失败 0**。
`od tools deliverable-syntax check` 一类需要 `OD_TOOL_TOKEN` 的接口在裸 CLI 下**跑不了**，按「没跑」记。

逐条明细、有意偏离与待办：[08-checklist.md](08-checklist.md)。

## 过程指针

- 决策链与每阶段产物：`00-brief.md` → `01-template.md` → `02-style.md` → `03-layouts/`（三版骨架，选定 A）→ `03-layout.html` → `04-fill.html` → `05-interaction.html` → `07-motion.html` → `08-prototype.html`
- 每阶段反馈与改动：[04-rounds.md](04-rounds.md)；骨架并排对比页：[03-compare.html](03-compare.html)
- 截图：根目录 `08-final-*.png`（浅色 1440/1024/768）· `08-dark-*.png`（深色）· `08-proof-*.png`（交互实测）· `shots/`（阶段过程图）—— **不入库，仅在产出机上保留**（位图可由 `08-prototype.html` 现场打开替代，不让仓库背 6 MB 二进制）
- 可回退的每阶段存档：`history/` —— **不入库，仅在产出机上保留**（阶段产物已由上面的 HTML 逐阶段覆盖，完整存档可回产出机取）

产物由 open-design skill 生成（六阶段流水线：骨架 → 填充 → 交互 → 填色 → 动画 → 原型），流程与判据见该 skill 的 SKILL.md。
