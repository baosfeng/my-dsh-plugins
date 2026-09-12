# dsh-my-memory

> DSH（DeepSeek Harness）记忆插件：**全局/项目两级记忆持久化**，全局记忆在会话开始时注入系统提示词（agent 始终携带你的关键偏好），设置页可视化面板管理（新增/修改/删除均需自定义确认 UI 确认），`memory_query` 工具只读查询、`memory_save` 工具经用户确认后保存记忆。**记忆内容精简（issue #105）**：保存引导浓缩为 1-2 句、面板概要/详情两级展示、注入按语义截断不截断句子中间。**渐进式索引记忆（issue #78）**：会话结束后自动提取记忆候选（`autoLearn` 开关，默认关）进入待确认列表，确认后写入——条目带分类/来源/置信度/更新时间/演进历史元数据，同主题多次出现提升置信度、矛盾标记待确认、长期未用降权，注入按相关性+时效性+置信度智能选择。纯官方依赖（面板挂在官方设置页扩展点，不依赖第三方插件）。

[![npm](https://img.shields.io/npm/v/dsh-my-memory)](https://www.npmjs.com/package/dsh-my-memory)

![记忆面板：全局/项目分区 + 自定义确认 UI（删除红色、保存绿色）](./assets/screenshot.png)

## 功能

- **两级记忆**：
  - **全局记忆**（跨项目）：用户偏好、常用习惯——存 `$DSH_HOME/memory.json`；
  - **项目记忆**（按项目 cwd 隔离）：项目约定、技术栈决策——存 `$DSH_HOME/memory/projects/<项目 id>.json`（issue #108：集中 `$DSH_HOME`，项目 id 由项目根路径 sha256 前 12 位确定；按 cwd 向上找 `.git` 定位项目根）。旧版本存于 `<项目根>/.dsh/memory.json` 的既有记忆在首次访问该项目时**自动迁移**到新位置，记忆不丢失。注：dsh-my-skill-manager 的项目配置仍存项目目录（`<项目根>/.dsh/`），与 dsh-my-memory 原模式相同，是否一并集中到 `$DSH_HOME` 另行评估，避免两套模式长期并存。
- **系统提示词注入**：会话开始时把全局记忆注入系统提示词（`ctx.systemPrompt.section`，order -95，persona 之前），agent 始终携带用户关键偏好；注入受条数（`maxItems`，默认 5）与单条长度（`maxDescLength`，默认 200）双重上限，**按语义截断优先概要/首句、不截断在句子中间**（issue #105）；**智能选择注入条目**（issue #78，替代简单 top-N）：先对长期未用条目降权，再按**相关性（当前会话上下文）+ 时效性 + 置信度**评分选 top-N；记忆变更后下一轮组装即时生效，无需重启。
- **自动学习记忆候选**（issue #78）：开启 `autoLearn` 后，会话结束（agent idle）自动从对话提取记忆候选（偏好/事实/项目/技术栈/工作流 5 类），进入面板「自动学习候选（待确认）」区块——**确认后写入**（同主题自动提升置信度）、拒弃则丢弃，**记忆绝不静默变更**；提取方式可配置 `extractor: 'rule'`（确定性规则提取器，默认）或 `'llm'`（预留占位）。
- **渐进式索引**（issue #78）：记忆条目带**分类**（偏好/事实/项目/技术栈/工作流）/**来源**（会话 id + 时间）/**置信度**（多次出现提升，上限 5）/**更新时间**/**演进历史**（新增/强化/矛盾记录）元数据，旧数据自动回退默认值不丢不崩；同主题多次出现 → 置信度提升/内容更新，内容分歧标记「待处理矛盾」，长期未用（默认 90 天）降权；面板条目卡显示分类徽标 + 置信度 + 矛盾警示 + 可展开「演进历史」。
- **可视化面板**：设置 → 插件 → 「记忆」页签（官方 slots 扩展点），**全局/项目分区显示**（项目 section 蓝色 accent + 项目根徽标），支持新增/修改/删除；底部「自动学习候选（待确认）」区块展示候选（分类徽标 + 来源会话 + 时间）与确认/拒弃按钮。
- **记忆内容精简**（issue #105）：保存时引导浓缩——输入框提示「建议 1-2 句话概括」、超过 `maxEntryLength`（默认 50 字）显示「内容过长，建议精简为 1-2 句」、确认面板显示概要预览；面板**概要/详情两级展示**——列表显示首句概要可扫读、点击「展开」查看完整详情（存储始终保留完整 desc，展示层截断，信息不丢）。
- **写操作需用户确认**：所有新增/修改/删除必须经**自定义确认 UI**（基于 ask 改造，不用原生 confirm）——**删除红色醒目 + 二次确认**，**保存/新增绿色确认**；服务端强制 `confirmed: true` 标记，缺失即 400 拒绝，记忆绝不静默变更；候选确认/拒弃同样强制该标记。
- **工具查询**：`memory_query` 工具（只读）让 agent 查询记忆详情——全局/项目过滤 + 关键词过滤，项目 cwd 取会话工作目录。
- **工具保存**（issue #107）：`memory_save` 工具让 agent 主动保存记忆（`scope`/`desc` 必填、`cwd` 可选）——每次调用都经 **DSH 原生审批确认**（`tools/pre-execute` 返回 `{ kind: 'ask' }`，用户确认后才写入），记忆绝不静默变更；保存后 `memory_query` 立即可查、后续会话注入生效。
- **持久化可靠**：原子写（tmp+rename）+ 防抖（300ms 合并写盘），重启后自动恢复，不丢记忆；项目记忆集中 `$DSH_HOME` 管理（issue #108），旧 `<项目根>/.dsh/memory.json` 数据首次访问自动迁移，项目目录不产生 `.dsh/`；候选独立存 `$DSH_HOME/memory/candidates.json`，与正式记忆完全隔离。

## 安装

```bash
# npm 安装（推荐）
dsh plugin --profile web add dsh-my-memory --trust-lockfile

# 或从本仓库 link 安装
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-memory
```

## 使用

1. 打开 DSH Web 设置 → 插件 → **记忆**；
2. **全局记忆**区块：输入要记住的内容（输入框提示「建议 1-2 句话概括」；超过 `maxEntryLength` 显示「内容过长，建议精简为 1-2 句」，确认面板显示概要预览）→ 绿色「新增」→ 绿色确认面板「确认保存」→ 写入 `$DSH_HOME/memory.json`；列表显示**概要（首句）**、点击「展开」查看完整详情；条目可「编辑」（绿色保存确认）或「删除」（红色确认面板 + 红色「确认删除」二次确认）；
3. **项目记忆**区块：**面板打开时自动加载当前会话项目的记忆**（issue #104，经 `/my-memory/api/session` 解析会话 cwd，复用 `memory_query` 的会话 cwd 定位逻辑），显示项目记忆（蓝色 accent + 项目根徽标），操作同全局；亦可在顶部输入其他项目根路径 → 「加载」切换查看其他项目记忆；
4. **自动学习候选**（issue #78）：在 `cordis.yml` 开启 `autoLearn` 后，会话结束自动从对话提取记忆候选，显示在面板底部「自动学习候选（待确认）」区块（分类徽标 + 描述 + 来源会话 + 时间）——点「确认写入」候选渐进合并进正式记忆（同主题自动提升置信度），点「拒弃」丢弃；候选绝不静默写入正式记忆；
5. 新会话开始时，全局记忆自动注入系统提示词（agent 可见）；agent 可用 `memory_query` 工具查询记忆详情（含项目记忆），也可用 `memory_save` 工具保存记忆——**默认仍需用户确认**；仅在会话权限模式为「完全权限」（`danger-full-access`，即 approval policy = `never`）时按 `saveApproval` 策略免确认直接写入（条目带来源会话标记、面板可见可删除，issue #208）。发现值得记住的信息时可请 agent 保存（如「把「用 pnpm 装依赖」记到记忆里」）。

## 权限模式与保存确认（issue #208）

DSH 的会话权限 preset 同时决定 sandbox 与 approval policy：`danger-full-access` → **approval policy = `never`**，此时宿主对任何 `{ kind: 'ask' }` 审批请求**直接判 rejected**（`@deepseek-ai/dsh-user-approval/lib/index.js:178`），不会弹出确认窗口。旧版 `memory_save` 无条件返回 ask，于是在「完全权限」模式下 100% 失败、用户还看不到任何提示——这是「AI 存不了记忆」的第二环根因（#191 修的是第一环：工具输出 schema）。

插件现按会话审批策略 + `saveApproval` 配置决定行为：

| `saveApproval` | 会话 approval policy = `ask`（如 workspace-write） | 会话 approval policy = `never`（如 danger-full-access）                                   | 策略判定失败（未知）       |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------- |
| `auto`（默认） | 弹原生确认窗口；拒绝则不写入                       | **免确认直接写入**（条目标记来源会话、面板可见可删）                                      | 弹原生确认（保守，不放行） |
| `always`       | 弹原生确认窗口；拒绝则不写入                       | **明确失败**并返回可操作中文提示（改 `saveApproval` / 切 workspace-write / 面板手动新增） | 弹原生确认                 |
| `never`        | 免确认直接写入（高级用法）                         | 免确认直接写入                                                                            | 免确认直接写入             |

- **策略判定**：首选宿主 approval 服务的 `effectivePolicy(session)`（与宿主判定同一函数），回落会话日志 `approval/policy` 事件折返（与宿主 `overrideOf` 同构），两者都不可用时按 `ask` 保守处理；
- **「记忆绝不静默变更」的调整理由**：`danger-full-access` 是用户**主动选择**「全权委托 agent、不要弹窗」的模式（同一模式下 bash 写文件等操作同样不确认），此时再坚持 ask 只会得到一个用户完全看不见的 rejected——既没保护用户，也让功能不可用。因此 `auto` 在 `never` 下改为「直接写入 + 标记来源会话 + 面板可见可撤销」，把不可见的静默失败换成可见、可追溯、可撤销的写入；需要逐条确认的用户把 `saveApproval` 设为 `always`。
- **来源标记**（issue #209）：agent 保存的条目记录 `source.sessionId`（写入会话）与 `source.at`，`memory_query` 输出与面板卡片显示会话前缀；面板手动新增的条目来源为空，据此可区分「agent 自动保存」与「用户手动添加」。

## 配置

```jsonc
// cordis.yml 中 my-memory 的 config 字段
{
  "maxItems": 5, // 注入系统提示词的全局记忆条数上限（默认 5；#78 起按相关性+时效性+置信度评分选 top-N）
  "maxDescLength": 200, // 单条记忆注入长度上限（字符，默认 200；语义截断优先概要/首句）
  "maxEntryLength": 50, // 建议单条记忆长度上限（字符，默认 50；超长时面板提示精简，issue #105）
  "autoLearn": false, // issue #78 自动学习开关：会话结束自动提取记忆候选进「待确认」区（默认关；开启后才提取，确认后才写入）
  "extractor": "rule", // issue #78 提取方式：rule（确定性规则提取器，默认）| llm（预留占位，接入 LLM 总结式提取）
  "proactivePropose": false, // issue #78 阶段预留：开启后 memory_save 工具描述引导 agent 主动向用户提议保存记忆（默认关，agent 按用户要求保存）
  "saveApproval": "auto", // issue #208 保存确认策略：auto（默认）| always | never —— 见下方「权限模式与保存确认」
}
```

## 实现要点

- **持久化**：`lib/store.js` 双作用域存储（全局 `$DSH_HOME/memory.json` + 项目 `$DSH_HOME/memory/projects/<项目 id>.json`，issue #108 集中位置，项目 id = 项目根路径 sha256 前 12 位；旧 `<项目根>/.dsh/memory.json` 首次访问自动迁移到新位置并清理旧文件），原子写（tmp+rename）+ 防抖（300ms 合并写盘）+ 启动 `load()` 恢复缓存；写操作 await 恢复完成，避免重启竞态覆盖；待确认候选独立存 `$DSH_HOME/memory/candidates.json`（`createCandidatesStore`，与正式记忆完全隔离——正式记忆文件只含用户确认过的条目）。
- **记忆内容精简**（issue #105）：`lib/memory-text.js` 纯函数（`firstSentence`/`summarizeDesc`/`isOverEntryLimit`，句子边界截断、概要优先，为 #78 自动提取预留）；client 同款逻辑在 `src/client/parts/utils.ts`；`GET /my-memory/api/config` 暴露 `maxEntryLength`/`maxDescLength` 供面板提示；面板列表显示首句概要、点击展开完整详情；存储保留完整 desc、不硬拒绝超长保存（引导而非限制）。
- **自动提取**（issue #78）：`lib/extract.js` 规则提取器（`extractCandidates`：偏好/事实/项目/技术栈/工作流 5 类句式模式 + 项目性关键词 → scope 建议 全局/项目 + 单会话上限 + 去重；`splitSentences` 句子边界拆分）；`index.js` 监听 `session/event`（user/message，过滤插件注入）只读收集本次会话用户消息，`agent/status` idle（仅顶层 agent）触发提取——候选进待确认区，`autoLearn` 默认关、`extractor: 'rule' | 'llm'`（llm 预留占位）。
- **渐进式更新 + 智能注入**（issue #78）：`lib/memory-scoring.js` 纯函数——`mergeCandidate`（同主题判定：分类 + 归一文本包含/子序列；新增/置信度+1（上限 5）/内容更新/矛盾标记；跨明确分类不坍缩）、`decayConfidence`（默认 90 天未用降权、下限 1）、`scoreForInjection`/`pickForInjection`（相关性：上下文关键词命中占比；时效性：exp 衰减 7 天半衰期；置信度：归一化因子；默认权重 0.5/0.3/0.2）；确认写入走 `store.mergeAdd`；`lib/prompt.js` 的 section 先降权再按评分选 `maxItems` 条（替代简单 top-N），配合语义截断。
- **系统提示词注入**：`lib/prompt.js` 注册 `dsh-my-memory` section（order -95），text 为 provider 函数——每次组装系统提示词时读取全局记忆缓存，智能评分选 `maxItems` 条、每条**按语义截断** `maxDescLength` 字符（优先概要/首句，不截断句子中间）；空记忆渲染空 section（renderPrompt 自动丢弃，零成本）。
- **工具**：`lib/tool.js` 直接构造 ToolDefinition（JSON Schema 参数/输出，不导入 `@deepseek-ai/dsh-tools`——本仓库插件只解析 Node 内置模块与相对路径），`ctx.tools.register` 注册 `memory_query`（只读）与 `memory_save`（写，工具描述引导「浓缩为 1-2 句」）。
- **保存确认门**（issue #107 / #208）：`lib/save-policy.js` 的 `createMemorySaveGate` 注册在 `tools/pre-execute`，按 `saveApproval` × 会话 approval policy 决策（allow / ask / deny + 可操作提示）；`approvalPolicyOf` 优先调用宿主 `ApprovalService.effectivePolicy(session)`，回落会话日志 `approval/policy` 折返（`exec.agent.session` 的 `seq` + `eventAt`）；写入统一带 `source: { sessionId, at }`（`exec.agent.id` 即会话 id，宿主 `dsh-agent` 校验 `agent.id === agent.session.id`）。
- **写操作 API**：`lib/api-route.js` 的 `POST /my-memory/api/memory` 强制 `confirmed: true` 用户同意标记，缺失即 400；add/update/delete 各自校验（空 desc、未知 id 等）；`GET/POST /my-memory/api/candidates{,confirm,dismiss}` 管理待确认候选（读取/确认写入渐进合并/拒弃，均强制确认标记）。
- **自定义确认 UI + 候选区块**：`lib/client.js` 内联确认面板（`dmm-confirm`）——删除红色背景 + 红色「确认删除」按钮（二次确认），保存/新增绿色背景 + 绿色「确认保存」按钮；项目 section 蓝色 accent + 项目根徽标与全局区分；条目卡显示分类徽标 + 置信度 + 矛盾警示 + 「演进历史」展开；「自动学习候选（待确认）」区块（`CandidatesBlock`）展示候选（分类徽标 + 描述 + 范围 + 来源会话 + 时间）与确认写入/拒弃按钮。

## 开发

```bash
npm run build   # tsc 编译 src + 拼接 src/client/parts/*.ts 编译产物 → lib/client.js
npm test        # vitest（server + client 渲染路径）+ cucumber（Gherkin 验收）
```

## 相关文档

→ [记忆概述](../../docs/记忆/概述.md) · [需求清单](../../docs/记忆/需求清单.md)
