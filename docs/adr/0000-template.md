---
title: ADR-0000：<决策标题>
description: <一句话说明该决策>
status: proposed
---

# ADR-0000：<决策标题>

## 状态

`proposed` / `accepted` / `deprecated` / `superseded by ADR-000X`

> 新建 ADR 时状态为 `proposed`；决策落地（代码/文档已按决策执行）后改为 `accepted`；被新决策取代时改为 `superseded by ADR-000X`。

## 背景

<为什么需要做这个决策？描述问题、约束与触发事件（用事件与现象本身描述，不写日期、issue 编号或提交 hash）。事实必须可追溯：引用代码、文档或本机可复现现象，不写无法验证的推断。>

## 决策

<做了什么决策？具体、可执行、可验证。>

## 后果

### 正面

<决策带来的好处。>

### 负面

<决策带来的代价、风险与迁移成本。>

### 教训

<从决策中学到的经验，供后续决策参考。>

## 备选方案

<列出考虑过的其他方案及未采纳原因。>

---

## 使用说明（本文件为模板，新建 ADR 时删除本节）

1. 复制本文件为 `docs/adr/0001-<kebab-case-标题>.md`（编号递增，不重复使用）
2. 填写 frontmatter：`title`（ADR-000N：标题）、`description`、`status`
3. 按「状态 / 背景 / 决策 / 后果 / 备选方案」五节填写正文
4. 在 `docs/索引.md` 的「架构决策记录」小节登记入口
5. 决策落地后把 `status` 改为 `accepted`
