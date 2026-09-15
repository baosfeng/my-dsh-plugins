# dsh-my-memory

**dsh-my-memory**：DSH 记忆插件——**全局/项目两级记忆持久化**，全局记忆在会话开始时注入系统提示词，设置页可视化面板管理；提供 `memory_query`（只读查询）/ `memory_save` / `memory_delete` 三个 agent 工具，写操作默认经用户确认；可选**自动学习**从对话提取记忆候选待确认写入，条目带分类/来源/置信度/演进历史并按相关性 + 时效性 + 置信度智能选择注入。

[![npm](https://img.shields.io/npm/v/dsh-my-memory)](https://www.npmjs.com/package/dsh-my-memory)

![记忆面板：全局/项目分区 + 自定义确认 UI（删除红色、保存绿色）](./assets/screenshot.png)

## 功能

- **两级记忆**：全局记忆（跨项目偏好，存 `$DSH_HOME/memory.json`）与项目记忆（按项目 cwd 隔离的约定与决策，存 `$DSH_HOME/memory/projects/<项目 id>.json`）；旧位置 `<项目根>/.dsh/memory.json` 的记忆首次访问该项目时自动迁移，项目目录不再产生 `.dsh/`。
- **系统提示词注入**：会话开始时注入全局记忆（order -95，persona 之前），受条数 `maxItems` 与单条长度 `maxDescLength` 限制，按语义截断（优先概要/首句，不截断在句子中间）；选择条目时先对长期未用降权，再按相关性 + 时效性 + 置信度评分取 top-N。
- **可视化面板**：设置 → 插件 → 「记忆」，全局/项目分区显示（项目区带 accent 与项目根徽标），支持新增/修改/删除；列表显示首句概要、可展开详情；底部「自动学习候选（待确认）」区块。
- **写操作需确认**：所有新增/修改/删除经自定义确认 UI（删除红色 + 二次确认，保存绿色），服务端强制 `confirmed: true` 标记，缺失即 400 拒绝，记忆绝不静默变更。
- **工具**：`memory_query` 只读查询（全局/项目 + 关键词过滤，输出带每条记忆的分类与 id）；`memory_save` 保存（`scope`/`desc` 必填，`category` 为偏好/事实/项目/技术栈/工作流，默认 `fact`）；`memory_delete` 按 id 删除（删除不存在的 id 明确报错）。
- **自动学习（可选）**：开启 `autoLearn` 后会话结束自动提取记忆候选进待确认区，确认才写入（同主题自动提升置信度），拒弃即丢弃。
- **渐进式索引**：条目带分类/来源（会话 id + 时间）/置信度（上限 5）/更新时间/演进历史；同主题多次出现提升置信度或更新内容，内容分歧标记「待处理矛盾」，长期未用（默认 90 天）降权。
- **持久化可靠**：原子写（tmp+rename）+ 防抖（300ms），重启后自动恢复；候选独立存 `$DSH_HOME/memory/candidates.json`，与正式记忆隔离。

## 安装

```bash
# npm 安装（推荐）
dsh plugin --profile web add dsh-my-memory --trust-lockfile

# 或从本仓库 link 安装
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-memory
```

## 配置

`cordis.yml` 中 my-memory 的 `config` 字段，均可省略：

| 配置键             | 默认     | 作用                                                           |
| ------------------ | -------- | -------------------------------------------------------------- |
| `maxItems`         | `5`      | 注入系统提示词的全局记忆条数上限                               |
| `maxDescLength`    | `200`    | 单条记忆注入长度上限（字符，语义截断优先概要/首句）            |
| `maxEntryLength`   | `50`     | 建议单条记忆长度上限（字符），超长时面板提示精简               |
| `autoLearn`        | `false`  | 自动学习开关：会话结束提取候选进待确认区，确认后才写入         |
| `extractor`        | `'rule'` | 候选提取方式：`rule` 确定性规则提取器 / `llm`（预留）          |
| `proactivePropose` | `false`  | 开启后引导 agent 主动向你提议保存记忆                          |
| `saveApproval`     | `'auto'` | 记忆写操作（保存 + 删除）确认策略：`auto` / `always` / `never` |

## 权限模式与保存确认

DSH 会话权限 preset 同时决定 sandbox 与 approval policy：`danger-full-access` → approval policy = `never`，宿主对 `{ kind: 'ask' }` 审批直接判 rejected（不弹窗）。插件因此按会话审批策略 + `saveApproval` 决策：

- **`auto`（默认）**：策略为 `ask`（如 workspace-write）时弹原生确认；策略为 `never` 时免确认直接写入（条目标记来源会话、面板可见可删）。
- **`always`**：任何策略都要求确认；`never` 下明确失败并返回可操作提示（改 `saveApproval` / 切 workspace-write / 面板手动新增）。
- **`never`**：从不确认，直接写入或删除（高级用法）。
- 策略判定优先用宿主 approval 服务的 `effectivePolicy(session)`，回落会话日志 `approval/policy`，都不可用时按 `ask` 保守处理；`memory_delete` 复用同一道 `tools/pre-execute` 确认门与同一矩阵，确认文案带待删内容摘要。

## 相关文档

→ [记忆概述](../../docs/记忆/概述.md)
