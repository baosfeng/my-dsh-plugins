# dsh-my-memory

**dsh-my-memory**：DSH 记忆插件——**全局/项目两级记忆持久化**，全局记忆在会话开始时注入系统提示词，设置页三 tab 面板（全局记忆 / 项目记忆 / 全局提示词）管理；提供 `memory_query`（只读查询）/ `memory_save` / `memory_delete` 三个 agent 工具，写操作默认经用户确认。条目带分类/来源/置信度/演进历史，按相关性 + 时效性 + 置信度智能选择注入。

[![npm](https://img.shields.io/npm/v/dsh-my-memory)](https://www.npmjs.com/package/dsh-my-memory)

![记忆面板：全局/项目分区 + 自定义确认 UI（删除红色、保存绿色）](./assets/screenshot.png)

## 功能

- **两级记忆**：全局记忆（跨项目偏好，存 `$DSH_HOME/memory.json`）与项目记忆（按项目 cwd 隔离的约定与决策，存 `$DSH_HOME/memory/projects/<项目 id>.json`）；旧位置 `<项目根>/.dsh/memory.json` 的记忆首次访问该项目时自动迁移，项目目录不再产生 `.dsh/`。
- **系统提示词注入**：会话开始时注入全局记忆（order -95，persona 之前），受条数 `maxItems` 与单条长度 `maxDescLength` 限制，按语义截断（优先概要/首句，不截断在句子中间）；选择条目时先对长期未用降权，再按相关性 + 时效性 + 置信度评分取 top-N。
- **可视化面板**：设置 → 插件 → 「记忆」，三个 tab 切换：**全局记忆 / 项目记忆 / 全局提示词**。记忆条目显示首句概要，可展开查看来源会话、分类、置信度与演进历史；新增与编辑用多行自适应输入框（带字数计数与超长精简提示），保存/删除走居中确认弹层。项目 tab 跟随当前会话的项目根自动加载，无需手填路径。
- **写操作需确认**：所有新增/修改/删除经自定义确认 UI（删除红色 + 二次确认，保存绿色），服务端强制 `confirmed: true` 标记，缺失即 400 拒绝，记忆绝不静默变更。
- **工具**：`memory_query` 只读查询（全局/项目 + 关键词过滤，输出带每条记忆的分类与 id）；`memory_save` 保存（`scope`/`desc` 必填，`category` 为偏好/事实/项目/技术栈/工作流，默认 `fact`）；`memory_delete` 按 id 删除（删除不存在的 id 明确报错）。
- **渐进式索引**：条目带分类/来源（会话 id + 时间）/置信度（上限 5）/更新时间/演进历史；同主题多次出现提升置信度或更新内容，内容分歧标记「待处理矛盾」，长期未用（默认 90 天）降权。
- **全局提示词（与记忆隔离）**：设置页「全局提示词」分区可新增 / 编辑 / 删除 / 启停 / 上移下移任意自由文本指令；**启用的提示词每轮组装全量按序注入**（独立 section `dsh-my-memory:prompts`，order -85），不评分、不截断、不占记忆的 top-N 名额，保存后下一轮即生效（无需重启）。它们**不是记忆**：独立文件 `$DSH_HOME/memory/prompts.json`、独立端点 `/my-memory/api/prompts`、agent 无写工具；首次运行迁入内置种子「中文思考」（可停用/删除，删除不复活）。
- **Agent 记忆（issue #502，第四套体系）**：agent 自主维护的跨会话记忆，与全局/项目记忆、全局提示词完全隔离。**零常驻注入**——正文只在 agent 主动读取时进入上下文，不命中则零 token；正文是纯 markdown（无日期、无 id），元数据（创建时间/最后读取/读取次数/归档）单独存 `index.json` 且 **agent 不可见、不可写**；4 个工具 `agent_memory_{list,read,write,delete}`（成功只回 `ok`，每个工具都按宿主契约声明 `output { schema, render }`），路径白名单 + 尺寸红线 + 敏感信息扫描三道硬门禁；超过 `archiveDays`（默认 180 天）未读自动归档——**归档后 agent 仍读不到，但面板能看到正文并一键恢复**（正文搬回原位 + 清归档标记；写入同名文件同样自动复活）。设置页第四个 tab 提供文件视图与元数据面板。
- **持久化可靠**：原子写（tmp+rename）+ 防抖（300ms），重启后自动恢复；提示词独立存 `$DSH_HOME/memory/prompts.json`，与正式记忆隔离。

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
| `proactivePropose` | `false`  | 开启后引导 agent 主动向你提议保存记忆                          |
| `saveApproval`     | `'auto'` | 记忆写操作（保存 + 删除）确认策略：`auto` / `always` / `never` |
| `maxPromptItems`   | `20`     | 注入系统提示词的全局提示词条数上限（超出不注入 + warn）       |
| `maxPromptLength`  | `1000`   | 单条提示词正文上限（字符，超出截断 + warn）                   |
| `agentMemory.enabled` | `true` | 是否启用 agent 记忆（第四套体系，issue #502） |
| `agentMemory.archiveDays` | `180` | 冷记忆归档阈值（天）：超过该天数未被 agent 读取即移入 `archive/`（面板可见并可恢复） |

## 权限模式与保存确认

DSH 会话权限 preset 同时决定 sandbox 与 approval policy：`danger-full-access` → approval policy = `never`，宿主对 `{ kind: 'ask' }` 审批直接判 rejected（不弹窗）。插件因此按会话审批策略 + `saveApproval` 决策：

- **`auto`（默认）**：策略为 `ask`（如 workspace-write）时弹原生确认；策略为 `never` 时免确认直接写入（条目标记来源会话、面板可见可删）。
- **`always`**：任何策略都要求确认；`never` 下明确失败并返回可操作提示（改 `saveApproval` / 切 workspace-write / 面板手动新增）。
- **`never`**：从不确认，直接写入或删除（高级用法）。
- 策略判定优先用宿主 approval 服务的 `effectivePolicy(session)`，回落会话日志 `approval/policy`，都不可用时按 `ask` 保守处理；`memory_delete` 复用同一道 `tools/pre-execute` 确认门与同一矩阵，确认文案带待删内容摘要。

## 相关文档

→ [记忆概述](../../docs/记忆/概述.md)