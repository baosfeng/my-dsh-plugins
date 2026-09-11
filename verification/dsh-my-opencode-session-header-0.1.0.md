# 发版前功能级验证清单 — dsh-my-opencode-session-header@0.1.0

验证时间：2026-09-11 09:53–09:55（本地 UTC+8；探针时间戳 2026-09-11T01:53:20Z）
验证环境：隔离实例（独立 `DSH_HOME=/tmp/dsh-opencode-verify`，headless profile；provider `opencode-go` → `https://opencode.ai/zen/go/v1`，模型 `deepseek-flash`；`NODE_OPTIONS=--import` fetch 探针取证）。主实例核查用 `dsh --profile web --dump-config`（只读，未重启）。

## 自动验证项（verify-real-profile.mjs 自动执行）

- [x] 配置组合唯一性（dump-config 无重复插件行 id）
- [x] 实例启动就绪（HTTP 200）
- [x] 启动日志无 error / duplicate 记录
- [x] 插件 API 冒烟（--api-path 全部 200）

## 功能级验证项（需在隔离实例 + 真实浏览器中验证后勾选）

- [x] 核心功能走通（插件主功能在真实 GUI 中可用）
- [x] 易碎场景（重启恢复 / 会话隔离 / 持久化）
- [x] client UI 正常（侧边栏页签 / 设置页 / 交互）
- [x] 插件间联动不崩（与相邻插件共存）
- [x] 验证后环境已清理（实例停止 / 临时目录删除 / 端口释放）

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。

## 验证记录

### 插件与变更

`dsh-my-opencode-session-header@0.1.0` 是纯 server 型插件（无 client 端、无 HTTP 路由）：包装 `llm/stream` 建立 AsyncLocalStorage 会话上下文 + 单层 `globalThis.fetch` 补丁，为 opencode.ai（含子域）的推理请求补 `x-opencode-session` 头，修复 OpenCode Go 网关 `400 MissingSessionID`（`valueMode: uuid` → 头值为裸 UUID）。

### 核心功能走通：对照组 + 实验组（真实模型调用）

探针用 `NODE_OPTIONS=--import` 包住最内层 `fetch`，记录每条出站请求的 `x-opencode-session` / `authorization` 头（JSONL）。两组除插件外环境完全相同。

| 组                                            | CLI 结果                                                                                                                                         | 探针记录                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 对照组（无插件，`--profile headless`）        | `INVALID_REQUEST: 400: {"type":"MissingSessionID","message":"Error from provider (Console Go): Request is missing x-opencode-session…"}`，exit 1 | `hasSessionHeader=false`（同时证明 DSH 自身不发该头）、`hasAuthorization=true`                                                                                |
| 实验组（有插件，`--profile headless-verify`） | 模型真实返回 `PONG`，exit 0                                                                                                                      | `hasSessionHeader=true`、`sessionHeader="a8273160-1cb2-4519-be53-e7cf0778aee0"`（裸 UUID，`valueMode: uuid` 生效）、`hasAuthorization=true`（补头未破坏鉴权） |

- 对照组先复现问题（无插件必 400），实验组才证明修复来自插件本身；只有实验组通过不足以定论。
- `hasAuthorization=true` 双向确认：补头没有挤掉/覆盖鉴权头。

### 易碎场景（冷启动 / 会话隔离）

- 每组都是一次独立冷启动进程（`dsh --profile … "…"` 一次性任务，跑完即退）：实验组两轮独立进程均返回 `PONG`，会话头值各自生成且稳定（同进程内多次请求同值）。
- 主实例（真实生产配置组合）在插件启用下持续正常工作：当前会话走 `opencode-go/deepseek-flash`，38 条 assistant 消息、0 条真实错误——补头插件对既有会话无副作用。

### client UI 正常

该插件为纯 server 型，无 client bundle / 无侧边栏页签（不是 UI 插件）。判定依据：插件启用下 DSH Web GUI 主实例正常加载与会话（见上），未引入 client 注册或渲染改动。

### 插件间联动不崩

主实例 `dsh --profile web --dump-config` 只读核查：**172 个 entry、0 重复**，`opencode-session-header` 已启用，与其余 18 个插件行共存无 duplicate loader entry。隔离实例同样以生产配置组合启动通过（配置组合唯一性检查）。

### 验证后环境已清理

- 隔离实例已停止：`lsof -ti :<port>` 无监听、`curl` 无响应（exit 7）。
- 隔离目录 `/tmp/dsh-opencode-verify`（含复制进来的 `.credentials.yaml`）已删除，无残留目录。
- 无残留 `dsh --profile headless` 进程；主实例（3080）未重启、未中断（本次全程只做只读 `--dump-config` 核查）。
- ⚠️ 另发现 `/tmp/dsh-verify-real-3087`、`/tmp/dsh-verify-session` 等**历史遗留**验证目录（非本次创建、无进程占用），未清理以免打断其它 agent 的验证——这正说明收尾复查（删完再看一眼 + 端口/进程双查）必须执行。

### 命令可复现性复跑（skill 交付时逐条复跑）

`skills/verifying-dsh-plugins/SKILL.md` 的隔离实例命令按原文复跑，全部通过：

- 隔离 web 实例：`node scripts/verify-real-profile.mjs --addons plugins/dsh-my-opencode-session-header --port 3099 --keep` → `✓ 配置组合唯一：172 个 id 无重复`、`✓ 实例启动就绪（HTTP 200, 端口 3099）`、`✓ 启动日志无 error / duplicate 记录`，exit 0；清理后端口释放、目录删除、`curl` exit 7。
- 隔离 headless 实例：`dsh --profile headless-verify --from-default-profile headless`（检查派生）→ `dsh plugin --profile headless-verify add link:…` → 对照组 400 / 实验组 `PONG` 复现成功（本轮探针 `sessionHeader="66a65b32-6b56-4b87-8ca0-cf8b610b04e5"`，同为零插件 400、有插件 200 的对照结论）。
- 注意：`verify-real-profile.mjs --keep` 提示的 `/tmp/dsh-verify-real-<port>.log` 实际不落盘（脚本未写该文件），取日志请自行重定向。

### 环境限制（如实注明）

1. 本轮未做浏览器级断言：该插件无 client 端，GUI 侧判定基于主实例真实会话运行（38 条 assistant 消息、0 真实错误）+ 配置组合核查，未新增截图。
2. 网关行为验证覆盖 `opencode-go/deepseek-flash` 单一 provider/模型；其它 provider 未验证。
3. 主实例核查数据取自该轮只读快照（172 entry、38 条消息），数字随后续会话增长会变化。
