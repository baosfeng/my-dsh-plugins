# 发版前功能级验证清单 — dsh-my-skill-manager@0.1.7

验证时间：2026-09-13T07:40:08.275Z（自动项，脚本生成）/ 2026-09-13T15:42—15:57（+0800，功能级浏览器实测）
验证环境：隔离实例（端口 3100，复用生产 profile 配置组合，独立 DSH_HOME=/tmp/dsh-verify-real-3100，预置工作区 /Users/bsfeng/IdeaProjects/my-dsh-plugins，Chrome for Testing 152 + agent-browser CLI 独立会话 dsh-my-skill-manager-ba7b32df3d04，真实模型 DeepSeek Flash）

## 自动验证项（verify-real-profile.mjs 自动执行）

- [x] 配置组合唯一性（dump-config 无重复插件行 id）
- [x] 实例启动就绪（HTTP 200）
- [x] 启动日志无 error / duplicate 记录
- [x] 插件 API 冒烟（--api-path 全部 200）

## 功能级验证项（需在隔离实例 + 真实浏览器中验证后勾选）

- [ ] 核心功能走通（插件主功能在真实 GUI 中可用）
- [x] 易碎场景（重启恢复 / 会话隔离 / 持久化）
- [x] client UI 正常（侧边栏页签 / 设置页 / 交互）
- [x] 插件间联动不崩（与相邻插件共存）
- [x] 验证后环境已清理（实例停止 / 临时目录删除 / 端口释放）

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。

## 验证记录（0.1.7 = TS 迁移 + 设置页 slots 首屏时序修复 + #165 清理 inject 声明）

### 1. 环境前置（issue #220 / #240，全部通过）

- 插件解析路径校验（脚本打印 + 手工复核，指向本仓库待验版本，非主工作区别名）：
  \`\`\`
  readlink /tmp/dsh-verify-real-3100/profiles/web/node_modules/dsh-my-skill-manager
  → /Users/bsfeng/IdeaProjects/my-dsh-plugins/plugins/dsh-my-skill-manager
  realpath … → 与 expected /Users/bsfeng/IdeaProjects/my-dsh-plugins/plugins/dsh-my-skill-manager 一致 ✓
  \`\`\`
- 隔离 \`profiles/web/.dsh-market/state.json\` = \`{"disabled":[],…}\`（生产名单 6 项已剥离）✓
- 隔离 \`cordis.patch.yml\` 的 \`disabled: true\` 行为 my-context / task-reliability / ts-example / guardian / observability / session-title-gen / notify 等，**不含 my-skill-manager**；dump-config 中 \`- id: my-skill-manager / name: dsh-my-skill-manager\` 已启用 ✓
- 启动输出（\`/tmp/dsh-verify-real-3100.console.log\`，保留备查）：配置组合唯一 172 个 id 无重复、插件已进组合、HTTP 200 就绪、日志无 error ✓
- 模型可用性：脚本生成的 settings.yaml 无 provider，按 Leader 指引复制生产 \`settings.yaml\` + \`.credentials.yaml\` 后重启，GUI 不再弹「添加一个 API Key」，真实模型调用成功 ✓

### 2. 核心功能走通 —— **不通过**（GUI/配置链路正常，但「禁用即不注入会话」的核心声明未生效）

**A. 插件自身链路（全部通过，真实 GUI 交互）**

浏览器操作序列：\`设置\` → \`插件\` → tab \`Skill 管理\` → 全局视角 20 行 → 点击 \`scan-to-docs\` 开关：

| 断言点        | 实测值                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开关 DOM      | \`aria-label="scan-to-docs: 已禁用"\`、\`aria-checked="false"\`、行 class 含 \`dsh-my-skill-manager-row-disabled\`                                          |
| 网络请求      | \`PUT /my-skill-manager/api/config\` 200 → 随后 \`GET /my-skill-manager/api/list\` 200                                                                      |
| 落盘          | \`$DSH_HOME/skills.enabled.json = {"global":{"disabled":["scan-to-docs"]},"project":{"disabled":[]}}\`                                                      |
| 插件 API 回读 | \`GET /my-skill-manager/api/list\` → \`{global:{disabled:["scan-to-docs"]}}\`，该行 \`source\` 变 \`全局（disabled）\`（插件 API 层占位生效）               |
| 恢复启用      | 再点开关 → \`aria-label="scan-to-docs: 启用"\`、\`aria-checked="true"\`、\`source\` 回 \`全局（user-agents）\`、配置文件回 \`{"global":{"disabled":[]},…}\` |
| 仓库项目配置  | 全程未被改动（\`.dsh/skills.enabled.json\` 始终为 \`{"project":{"disabled":["c"]}}\`）                                                                      |

**B. 模型侧 —— 未生效（四路证据一致；这是插件的核心声明功能）**

README 原文声明：「**禁用的 skill 不再注入该项目会话：模型不可见、不可加载。**」

1. **官方会话目录 RPC**（浏览器带 token 调用 \`POST /api/skills/list\`，payload \`{args:{request:{sessionId}}}\`）
   - 新建会话 \`session-85a082d3-3c56-4dc3-a51e-ab7432b46a97\`（cwd=本仓库，禁用之后创建）：33 项、**含 scan-to-docs**，
     \`{"name":"scan-to-docs","description":"扫描项目生成/更新/整理/初始化规范化中文文档…","modelInvocable":true}\`（原始描述，非「已禁用」占位）
2. **GUI 模型上下文**：会话「上下文注入 → skill-catalog」区块（模型实际收到的注入）完整列出 scan-to-docs 真实描述，页面文本不含 \`已禁用（dsh-my-skill-manager）\` 占位串
3. **真实模型调用**（新会话，DeepSeek Flash，15:54，用量 29.9K tok）：
   - 模型思考原文：「从系统提示的 available_skills 看，确实包含 scan-to-docs。所以调用应该成功。」
   - 模型调用 \`skill\` 工具加载 scan-to-docs **成功**，返回 \`provider: filesystem\`、正文 **12030 字符**（原文照贴前 150 字：\`# scan-to-docs：代码扫描与规范文档生成…\`）
   - 模型明确回答：「包含。本会话注入的可用 skill 目录中确实存在 scan-to-docs」
4. **插件自己的使用统计反证**：\`$DSH_HOME/skills.usage.json = {"skills":{"scan-to-docs":{"count":1,"lastUsedAt":1789286086678,"lastSource":"model"}}}\`，
   GUI 该行显示「使用 1 次 · 最近 09-13 15:54 · 模型」——插件的 \`get()\` 包装只有在返回真实正文时才计数，等于插件自己记录了「被禁用的 skill 被模型成功加载」

**C. 排除缓存/时序**：kill 3100 → 同 DSH_HOME 重启（9s 就绪）→ 再建新会话 \`session-361d2181-17a8-46d1-a33b-17f9a5ad0fbf\` → \`skills 列表接口\` 仍返回 scan-to-docs 原始条目（\`modelInvocable:true\`），面板仍显示「已禁用」；另：仓库项目配置里长期存在的禁用名 \`c\` 从未在会话目录里产生占位条目。→ 非缓存问题，机制性失效。

**D. 疑似机制方向（供开发者复核，非本次结论）**：DSH \`dsh-skill\` 的 \`SkillRegistry\` 是**分层**注册表（源码注释：\`a read merges the global layer with the viewing scope's chain — the nearest layer's entry wins a duplicate name outright, and the rank order decides duplicates only within one layer\`）。插件把 rank-0 占位注册进 **global 层**，若官方 \`dsh-skill-filesystem\` 的候选位于更近的会话/preset 层，则「nearest layer wins」会让真实 skill 直胜，rank 0 无从生效；实例日志中也没有 \`skill "…" ignored because a higher-priority skill already exists\` 告警（跨层覆盖不产生该告警），与实测一致。

→ **结论：核心功能项不通过**（禁用开关在插件 UI/配置层完全可用，但对真实会话与真实模型无效，模型仍可见、仍可加载完整正文）。按「证据不足/功能未达不得勾选」原则，本项保持 \`[ ]\`，发版应被门禁阻断。

### 3. 易碎场景（重启恢复 / 会话隔离 / 持久化）—— 通过

- **重启恢复**：\`lsof -ti :3100 | xargs kill\` → 同 DSH_HOME 手动重启（\`DSH_HOME=/tmp/dsh-verify-real-3100 dsh --profile web --port 3100 --no-open\`，9s 就绪）→ 配置持久化保留（文件内容不变），浏览器重开后面板仍显示 \`scan-to-docs: 已禁用\`、rows=20、无 error 元素 ✓
- **会话隔离**：\`session/create\` 造 \`cwd=/tmp\` 会话 → 插件 API 返回 \`{"cwd":"/tmp"}\`；\`/list?cwd=/private/tmp\` → \`projectRoot=/private/tmp\`、\`projectDisabled=[]\`、项目 skill 数 **0**；对照本仓库视角 → \`projectRoot=本仓库\`、\`projectDisabled=["c"]\`、项目 skill 数 **13** → 按会话 cwd 解析项目配置、互不串数据 ✓
- **浏览器刷新/重载**：实例重启后重新打开页面，client bundle 正常重载、面板重新拉取数据 ✓（期间出现过一次浏览器进程自动重启导致 about:blank，\`open\` 后恢复，属 agent-browser 侧现象，非插件问题）

### 4. client UI 正常 —— 通过

- 页签渲染（官方 slots 扩展点，无第三方依赖）：设置 → 插件 → 「Skill 管理」；标题区 + 唯一刷新按钮（\`aria-label="刷新"\`）+ 分段控件「全局 / 当前项目」+ 排序过滤 Pill「未使用 / 名称 / 次数 / 最近」+ 每行 role=switch 开关 + 「未收录」warn 徽标 + 提示行文案
- 交互实测：视角切换 \`aria-pressed\` 20→13 行（标题变「当前项目 · 项目根：/Users/bsfeng/IdeaProjects/my-dsh-plugins」，来源全部「项目（project-dsh）」，与 API 返回的 13 项逐一一致）；「未使用」过滤 \`aria-pressed=true\`；「次数」排序切换生效；「刷新」触发 \`GET /my-skill-manager/api/rescan\` 200
- 使用统计 UI：scan-to-docs 行显示「使用 1 次 · 最近 09-13 15:54 · 模型」（#91 功能正常）
- \`agent-browser errors --json\` → \`"errors":[]\`（无未捕获异常）

### 5. 插件间联动不崩 —— 通过

- 配置组合唯一：dump-config **172 个 id 无重复**，\`dsh-my-skill-manager\` 在列（脚本自动项）
- 相邻插件共存：设置页插件区块同屏「文件活动 / 渲染 / Skill 管理 / 通知提醒 / 记忆 / 插件管理 / 插件市场」；右侧边栏「文件活动」面板正常
- 相邻插件路由在浏览器会话内均 200：\`/file-activity/api/record\`、\`/notify/api/stream\`（EventSource）、\`/sidebar/api/shell.get\`、\`/api/skills/list\`、\`/my-skill-manager/api/*\`
- 启动日志无 duplicate / failed to apply / error ✓

### 6. 环境已清理 —— 通过

\`\`\`
agent-browser close --all → ✓ Closed session: dsh-my-skill-manager-ba7b32df3d04
lsof -ti :3100 | xargs kill → port3100: 已释放（curl http_code=000 无响应）
rm -rf /tmp/dsh-verify-real-3100 → ls: No such file or directory（目录已删除）
rm -f ~/.agent-browser/dsh-my-skill-manager-* → 残留 0
rm -rf /tmp/dsh-3100-shots /tmp/dsh-3100-*.txt → 临时文件 0
pgrep -fl "choose folder" → 0（未触发原生目录对话框）
\`\`\`

- 未触碰其他 agent 的实例与目录（3099 / 3101 由他人使用）
- 如实记录一处附带影响：收尾用的 \`agent-browser close --all\` 同时关闭了另一个 agent 的会话 \`dsh-my-guard-ba7b32df3d04\`（agent-browser 会话级隔离在 close --all 下不生效）；对方下次命令会自动重启浏览器，未删除其会话数据

### 7. 环境限制与说明（如实记录）

1. \`--api-path\` 冒烟未在脚本层执行（issue #257：脚本取不到 token）；本次按 skill 指引改为**浏览器带 token 会话内 API 断言**：\`/my-skill-manager/api/{list,session,rescan}\` GET 与 \`/config\` PUT 全部 200——插件 server 路由确认可用，不是异常。
2. 自动项第 4 行「插件 API 冒烟（--api-path 全部 200）」为清单既有勾选（上一次脚本运行，端口 3097）；本次以第 1 条所述的浏览器内 API 断言覆盖同等意图。
3. 截图留档因当前会话模型不支持图像输入而无法核验，故未作为证据引用（文件已随清理删除）。
4. 本清单只写了 \`verification/dsh-my-skill-manager-0.1.7.md\` 一个文件；插件源码 / package.json / 脚本 / 仓库项目配置（\`.dsh/skills.enabled.json\`）全程未改动（\`git status\` 仅 verification/*.md 变更）。
