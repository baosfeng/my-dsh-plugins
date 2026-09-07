# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2026-09-07

### 变更

- feat(observability): #155 插件状态查询聚合——统一 status-query 事件 + /plugin-status API (#170)
- chore(plugins): #165 清理失效的 dsh.client.inject 声明（13 插件） (#167)

## [0.1.5] - 2026-09-06

### 变更

- feat(memory,skill-manager): #143 试点——官方组件库替换（Input/Pill/Button + 图标） (#157)
- feat(observability): #155 插件日志体系补齐——7 插件关键行为/异常结构化日志（基础层） (#159)

## [0.1.4] - 2026-09-04

### 变更

- fix(memory): 面板修正——置信度 undefined 不渲染、错误 token 修复、徽标不重复 scope、层级弱化

## [0.1.3] - 2026-09-04

### 变更

- feat(memory): #78 渐进式索引记忆（自动提取 + 结构化索引 + 渐进更新 + 智能注入） (#140)
- feat(memory): #105 记忆内容精简（保存引导 + 概要/详情两级展示 + 语义截断注入） (#139)
- feat(memory): #108 项目记忆存储迁移至 $DSH_HOME 集中位置 (#134)
- feat(memory): #107 记忆保存工具（agent 主动保存 + 用户确认） (#132)
- feat(memory): #110 记忆面板视觉重设计 (#119)
- fix(memory): #104 面板打开自动加载当前项目记忆 (#117)
- docs: #106 安装命令统一加 --trust-lockfile (#113)

## [Unreleased]

### Added

- **渐进式索引记忆（issue #78）**：
  - 自动提取：会话结束时（`agent/status` idle，仅顶层 agent）自动从本次会话的用户消息提取记忆候选（`session/event` 只读收集，过滤插件注入），`lib/extract.js` 规则提取器按偏好/事实/项目/技术栈/工作流 5 类句式模式 + 项目性关键词（scope 建议全局/项目）+ 单会话上限 + 去重；候选进「待确认」区存 `$DSH_HOME/memory/candidates.json`（与正式记忆隔离）；`autoLearn` 开关（默认关）+ `extractor: 'rule' | 'llm'`（llm 为预留占位）——候选经 `POST /my-memory/api/candidates/confirm|dismiss`（强制 `confirmed: true`）确认写入/拒弃，记忆绝不静默变更。
  - 结构化索引：条目带 `category / source（会话 id+时间）/ confidence（多次出现提升，上限 5）/ updatedAt / relatedIds / history（演进记录）/ status（矛盾标记）` 元数据；`withDefaults` 兼容旧数据（无元数据回退默认值，不丢不崩）；面板条目卡显示分类徽标 + 置信度 + 矛盾警示 + 可展开「演进历史」，底部「自动学习候选（待确认）」区块（分类徽标 + 来源会话 + 时间 + 确认/拒弃按钮）。
  - 渐进式更新：`lib/memory-scoring.js` 纯函数——`mergeCandidate`（同主题判定：分类 + 归一文本包含/子序列；新增/置信度+1/内容更新/矛盾标记，跨明确分类不坍缩）、`decayConfidence`（默认 90 天未用降权、下限 1）、`scoreForInjection`/`pickForInjection`（相关性：上下文关键词命中 + 时效性：exp 衰减 7 天半衰期 + 置信度：归一化，默认权重 0.5/0.3/0.2）；确认写入走 `store.mergeAdd`。
  - 智能注入：`lib/prompt.js` 的 section 先对长期未用条目降权，再按评分选 `maxItems` 条（替代简单 top-N），与 #105 语义截断配合。
- 测试：`test/extract.mjs`（规则提取 13 例）、`test/memory-scoring.mjs`（同主题/合并/降权/评分 18 例）、`test/candidates.mjs`（候选存储/确认拒弃 API/自动提取触发 14 例）；Gherkin 场景 12-18（自动提取/确认写入/渐进更新/元数据/智能注入/绝不静默变更）。
- `memory_save` 工具（issue #107）：agent 主动保存记忆（`scope`/`desc` 必填、`cwd` 可选），每次调用经 `tools/pre-execute` 确认门触发 DSH 原生审批（`{ kind: 'ask' }`），用户确认后才写入——记忆绝不静默变更；保存后 `memory_query` 立即可查、后续会话注入生效；`proactivePropose` 配置预留（默认关，#78 阶段）。

### Changed

- **项目记忆集中存储（issue #108）**：项目记忆从 `<项目根>/.dsh/memory.json` 迁移到 `$DSH_HOME/memory/projects/<项目 id>.json`（项目 id = 项目根路径 sha256 前 12 位），项目目录不再产生 `.dsh/`、数据统一备份/迁移；既有旧位置数据在首次访问该项目时自动迁移到新位置（复制 → 清理旧文件与空 `.dsh` 目录），记忆不丢失。
- 测试：迁移逻辑单测（复制/清理/跳过）+ 首次访问自动迁移集成断言 + 真实性路径保存断言改写。

## [0.1.2] - 2026-09-01

### 变更

- fix(ui): 9 个插件未定义 token danger-primary 改用 error-primary（DSH 主题仅定义 business/error/success/warn）

## [0.1.1] - 2026-08-28

### 变更

- feat(ui): dsh-my-memory 设置页翻新——图标/前缀/状态/交互（issue #54）
- refactor(shared): 抽取 dsh-shared 共享工具包，10 个插件迁移消除重复实现（issue #45）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）
- fix(lint): 修复 dsh-my-memory 测试文件未使用变量（saveEditBtn / Given，CI lint 失败）

## [0.1.0] - 2026-09-03

### Added

- 记忆插件（issue #38）：
  - 全局/项目两级记忆：全局 `$DSH_HOME/memory.json` + 项目 `<项目根>/.dsh/memory.json`（按 cwd 向上找 `.git` 定位项目根），原子写（tmp+rename）+ 防抖（300ms 合并写盘）+ 启动恢复；
  - 系统提示词注入：`dsh-my-memory` section（order -95，persona 之前），每次组装系统提示词时注入全局记忆（`maxItems` 条数上限 + `maxDescLength` 长度上限，空记忆零成本）；
  - 设置页面板：官方 slots 扩展点（设置 → 插件 → 记忆），全局/项目分区显示（项目蓝色 accent + 项目根徽标），支持新增/修改/删除；
  - 写操作需用户确认：自定义确认 UI（基于 ask 改造，不用原生 confirm）——删除红色醒目 + 二次确认、保存/新增绿色确认；服务端强制 `confirmed: true` 标记，缺失即 400；
  - `memory_query` 只读工具：全局/项目过滤 + 关键词过滤，项目 cwd 取会话工作目录；
  - 纯官方依赖（不依赖 dsh-better-sidebar）。
