---
title: ADR-0002：渲染插件保持独立，改走内部共享（不合并）
description: 记录「思考/图表/markdown 渲染插件是否合并」的决策——三条硬理由（combo 下载粒度、公共内核膨胀 75 倍、主题不同源）+ 内部共享替代路径（issue #186）
status: accepted
date: 2026-09-13
---

# ADR-0002：渲染插件保持独立，改走内部共享（不合并）

## 状态

`accepted`（2026-09-11 于 issue #186 定结论，2026-09-13 落地 P1/P2 内部共享）

## 背景

用户提出：「渲染要不要分这么多插件？思考渲染一个、图表渲染一个、markdown 渲染又是一个，这几个能不能合并？思考能不能只做思考的？」

这不是新话题——**issue #31（已关闭）当时的方向正好相反**：把渲染职责从 `dsh-think-zh-expand` 拆出去，形成单一职责的 `dsh-md-render`。本次是对该决策的重新审视，因此先在 issue #186 做了一轮实测调研再定结论。

调研纠正了三个常见印象（均以当前代码为准）：

| 印象 | 事实 | 证据 |
| --- | --- | --- |
| 「有一个独立的公式渲染插件」 | ❌ 不存在。math 在 `dsh-md-render` 内（`src/client/parts/math.ts` + `math-symbols.ts`，issue #82），零依赖自研 LaTeX 子集 | 全仓 grep `katex/mathjax/markdown-it/marked/highlight.js/prismjs` = 0 命中 |
| 「think 插件在做渲染」 | ❌ 已迁出（#31 落地）。think client 的 markdown 解析引用数为 0，主体是 UI 中文化词表 + 思考块展开交互 | `dsh-think-zh-expand/src/client/index.ts`；server 半只做 system-prompt 注入 |
| 「三个渲染插件各自为政」 | ❌ `dsh-md-render` **事实上已是渲染内核**，有 2 个下游：`dsh-think-zh-expand`（peerDep `^0.1.1`，硬依赖 require `MarkdownView`）与 `dsh-my-plugin-manager`（peerDep `^0.1.2`，try/catch 降级） | 两者 package.json 均声明 `dsh.client.external: ["dsh-md-render"]` |

体积现状（2026-09-13 实测 `lib/client.js`）：`dsh-md-render` 151 KB、`dsh-think-zh-expand` 42.8 KB、`dsh-mermaid-render` 4.49 MB（内联 vendored mermaid 引擎；#185 修复前为 8.93 MB，冗余注入 4.48 MB）。

宿主层面**无粒度限制**（`dsh-package-manifest` 明确「a package may declare several roles」；本仓库 `dsh-md-render` 一个插件已同时做 HTTP 路由 + 设置页 slot + 导出渲染内核 + DOM 扫描器）。所以「不能合并」不是宿主限制，而是**下载体积与发布耦合的取舍**。

## 决策

**保持 3 个独立插件**（`dsh-md-render` / `dsh-mermaid-render` / `dsh-think-zh-expand`），不合并；用户「想减少插件数量、降低维护面」的诉求改用**内部共享**满足——把逐字重复的 UI 样板收口到 `plugins/dsh-shared/client-parts/`，由各插件构建期拼接（构建时源文件，不经过 package exports / require 解析）。

三条硬理由（均有宿主源码或实测体积依据）：

1. **combo 机制下「拆」才有可选装价值**：宿主 `dsh-client-modules` 的 `partitionComboRecords`（按 URL 总长 ≤3 KB 分批）会把同批插件 bundle **拼进同一个 script 响应**。19 个插件 id 总长远小于 3 KB → 同一 combo，即「不装则不下载」；一旦合并，不用图表的用户也被强制下载数 MB。**诚实边界**：combo 分组未做端到端实测（本地实例读 `window.__DSH_BOOT__.batches` 需 token），此条依据宿主源码逻辑推理。
2. **合并会让公共内核膨胀 75 倍并波及所有消费方**：`dsh-md-render` 从 151 KB → ~4.6 MB，而它是 `dsh-think-zh-expand`（硬依赖）与 `dsh-my-plugin-manager`（降级路径）的依赖。
3. **三者主题不同源，合并后内部仍需分治**：think = 中文化 + system-prompt 注入；mermaid = 引擎 + 卡片 UI；md-render = markdown 解析管线。合并只增加耦合与发布耦合，不减少复杂度。

配套机制（本次落地）：**同一段 UI 样板在 ≥2 个插件逐字重复时，必须在 `dsh-shared/client-parts/` 建单一来源**，并配构建期「恰好一处注入 + 取值断言」门禁（#185 的模式）与产物级断言测试。

## 后果

### 正面

- 用户按需安装：不装 `dsh-mermaid-render` 就不下载 4.49 MB 引擎。
- 发布解耦：三个包独立版本、独立发版，一个插件的缺陷不阻塞其它插件。
- 下游契约稳定：`dsh-think-zh-expand` / `dsh-my-plugin-manager` 的 peerDep 与 `dsh.client.external` 不动。
- 维护面靠共享收口：图标（19 个 key / 324 行）、DOM 扫描器骨架、样式注入样板各只有一份来源。

### 负面

- 仍是 3 个包（用户初始诉求「减少插件数量」未直接满足，只满足「减少重复维护面」）。
- 跨插件共享只能走**构建期文本拼接**（client bundle 无相对路径 require），因此每个消费方都要在 `scripts/build.mjs` 里维护占位符与注入门禁——比运行时 import 笨重。
- 共享部件改动需重建并提交**所有**消费方的产物（本仓库 CI 不跑构建），漏重建会出现插件间行为漂移。

### 教训

- 「合并同类插件」的评估不能只看职责相似度：**下载粒度 + 依赖扇出**才是决定因素（理由 1、2）。
- 抽共享前先量化重复（行数 / 逐字相同程度）与差异（各自特有策略），差异大的只抽骨架、策略用参数注入；宁可少抽，不要为了「归一」削功能（本次 P2 的 `installScanner` 即按此处理）。

## 备选方案

| 方案 | 内容 | 未采纳原因 |
| --- | --- | --- |
| A：三者合并为一个「渲染插件」 | think + mermaid + md-render 合成一个包 | 不用图表的用户被强制下载 4.49 MB；think 的 system-prompt 注入与 mermaid 引擎无关却被迫同版本发布 |
| B：mermaid 并入 md-render（3 → 2） | 插件数减一 | 需同步改 2 个下游的 `external` 契约与 peerDep 范围，且所有 md-render 用户强制下载 4.49 MB；公共内核 151 KB → ~4.6 MB（已否决） |
| C：维持现状，不做共享 | 三处继续各写一份 | 图标 157 行已复制（mermaid 是 10 个消费方之外唯一漏接的），scanner 与样式样板继续漂移；#54 阶段的「单一来源」目标失效 |
| **D（采纳）：保持 3 包 + 内部共享** | `dsh-shared/client-parts` 收口图标/扫描器骨架/样式样板 | —— |

## 参考

- issue [#186](https://github.com/baosfeng/my-dsh-plugins/issues/186)（本决策的调研与验收标准）
- issue #31（渲染职责迁移，方向相反的历史决策）、issue #185（mermaid 冗余注入体积缺陷）
- [共享工具包](../共享工具包/概述.md) · [UI 规范](../UI规范.md#共享图标系统单一来源) · [md 渲染概述](../md渲染/概述.md) · [mermaid 渲染概述](../mermaid渲染/概述.md)
