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

## 独立复验（issue #183 验收第 2/3/4/5/7 条，2026-09-12）

复验者：issue #183 子 agent（独立上下文，未参与 0.1.0 实现）。分支 `feat/183`（基线 `origin/main` = `2cce091`，插件实现提交 `ec9a442` / `bfc01fc` 已在 main）。

**环境**：隔离 `DSH_HOME`（`/tmp/dsh-verify-183` = opencode-go 路由；`/tmp/dsh-verify-183-ds` = deepseek-official 路由），隔离 web 实例端口 3099，真实网关 `https://opencode.ai/zen/go/v1`；取证用仓库既有手法 `NODE_OPTIONS=--import` fetch 探针（`skills/verifying-dsh-plugins/scripts/fetch-probe.mjs` 的全量头版本：包住最内层 `globalThis.fetch`，逐条记录排序后的全部请求头 + sha256）。

> 方法注记（如实）：本轮取证层级是 **fetch 层全量请求头**（undici 序列化前一刻的字节），不是 TLS 中间人抓包——https 流量在 TLS 层不可读，做 MITM 需注入自签 CA 信任，风险与收益不成比例。探针由 `--import` 在 DSH 入口之前装载，插件补丁包装的是探针这一层，故探针看到的就是补丁最终交付给 undici 的请求头。

### 验收第 2 条：真实网关 400 → 200，头值逐字节等于会话 id ✅

| 组                                               | CLI 结果                                                                                                     | 探针记录（JSONL）                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 对照组 `headless-183`（无插件）                  | `dsh: INVALID_REQUEST: 400: {"type":"MissingSessionID","message":"Error from provider (Console Go)…`，exit 1 | `hasSessionHeader=false`、`hasAuthorization=true`、`headerCount=11`                             |
| 实验组 `headless-183-plugin`（本插件 link 安装） | 模型真实返回 `PONG`，exit 0                                                                                  | `hasSessionHeader=true`、`sessionHeader=cb797e0b-81fb-4472-b64e-71599f204410`、`headerCount=12` |

- **头值 == 会话 id（逐字节）**：隔离 DSH_HOME 的会话落盘目录为 `sessions/--private-tmp-gh-fork-183--/session-cb797e0b-81fb-4472-b64e-71599f204410/`，会话 id = `session-cb797e0b-81fb-4472-b64e-71599f204410`，`valueMode: uuid` 提取的裸 UUID 与探针记录的头值完全一致。
- **只加一个头，其余零变化**：对照组 11 个头的排序块 sha256 = `1eccb9faa75ca1c419d92d360aa00f914536c7e75cef9a8cf8845fc152c01949`；实验组 12 个头剔除 `x-opencode-session` 后 sha256 **相同**，请求体 sha256 亦相同。

### 验收第 3 条：同会话多轮 / 辅助调用 / 重启后头值不变；两个不同会话头值不同 ✅

4 个会话 4 个互不相同的头值，且每个值都等于**它自己**的会话 uuid：

| 会话 id（落盘目录）                            | 头值         | 取得方式                              |
| ---------------------------------------------- | ------------ | ------------------------------------- |
| `session-cb797e0b-81fb-4472-b64e-71599f204410` | `cb797e0b-…` | 进程 1（headless 实验组）2 条请求同值 |
| `session-7b3e3a0d-8e75-4e07-b51e-fa49265b56ad` | `7b3e3a0d-…` | 进程 2（headless 新会话）与上不同     |
| `session-f8b1e516-10b0-4987-ad08-6ee74c3a62fc` | `f8b1e516-…` | 见「重启后不变」                      |
| `session-97701888-9e25-4a4d-ac77-4d308a2e3084` | `97701888-…` | 见「辅助调用」                        |

- **多轮 + 辅助调用（会话标题）一次取证**：同一 GUI 会话内探针记录 3 条出站请求 / 2 种不同请求体，头值全部相同；另一次抓到逐字节请求体前缀——主对话 system = `You are an AI agent powered by DeepSeek Harness…`，辅助调用 system = `Create a concise title for an AI coding-assistant session from the supplied human messages…`，两条**都**带 `x-opencode-session: 97701888-9e25-4a4d-ac77-4d308a2e3084`（= 该会话 uuid）。
- **重启后不变**：进程 1（web 实例 :3099）会话 `f8b1e516-…` 首轮头值 `f8b1e516-10b0-4987-ad08-6ee74c3a62fc` → 杀掉实例（`lsof -ti :3099` 无监听、`curl` exit 7、无残留进程）→ **同一 DSH_HOME 重启实例**（新进程 / 新 token）→ 侧边栏重开同一会话再发一轮 → 头值仍为 `f8b1e516-10b0-4987-ad08-6ee74c3a62fc`（GUI 两轮消息均渲染，第二轮模型回复 `PONG-B`）。
- **辅助调用为什么必然覆盖（源码一致性）**：`GenerateOptions` 同时携带 `provider` 与 `sessionId`，并显式声明 `purpose?: 'compaction' | 'session-title'`（`@deepseek-ai/dsh-llm/lib/typert.host.js:287`）——压缩摘要 / 会话标题与主对话走同一个 `stream()`，而 `llm/stream` 是所有适配器的唯一 waterfall 出口（`@deepseek-ai/dsh-llm/lib/index.js:2307`），故一处包装即全覆盖。

### 验收第 4 条：非 opencode 路由开关前后字节级一致（真实对照实验）✅

- 隔离 `DSH_HOME=/tmp/dsh-verify-183-ds`，`settings.yaml` 的 `agent-default-model` 指向 `deepseek-official / deepseek-flash`（**非** opencode 路由）。
- 对照组（无插件）与实验组（有插件）各真实调用一次，探针各命中 2 条 `https://api.deepseek.com/chat/completions`，**均为 6 个头、均无 `x-opencode-session`**：`['accept','authorization','content-type','user-agent','x-deepseek-harness-session-id','x-deepseek-harness-user-id']`。
- 逐字节比较（仅遮蔽密钥/会话 id 值）：两侧 sha256 同为 `87f76a2223197452…` → **一致**。唯一差异项 `x-deepseek-harness-session-id`（对照组 `session-f7961044-2f42-4577-8212-ce0a26f25c8b` / 实验组 `session-59ddf6cc-1c3c-4e0f-9c41-dabed2ec391d`）恰好等于**各自那次运行自己的会话 id**（DSH 官方 deepseek 适配器行为），请求体差异同理——均与插件无关。
- 补强：宿主与官方包中 `globalThis.fetch` 赋值 0 处（`grep -rn "globalThis.fetch *=" …/node_modules/@deepseek-ai/` 无匹配），插件是 fetch 链上唯一补丁层。

### 验收第 5 条：add / remove 后 profile 均可正常启动 ✅

`web-183` = 隔离 DSH_HOME 内由 shipped `web` 模板派生的 profile。

| 阶段   | 命令                                                                           | 结果                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 加装   | `dsh plugin --profile web-183 add link:plugins/dsh-my-opencode-session-header` | exit 0；`--dump-config` 出现唯一装载行 `- id: opencode-session-header` / `name: dsh-my-opencode-session-header`；**重复 loader id 扫描 0 条** |
| 启动   | `dsh --profile web-183 --port 3099 --no-open`                                  | 打印 `dsh web: http://127.0.0.1:3099/`，HTTP 401（鉴权围栏 = 实例就绪），启动日志 0 `error` / 0 `duplicate`；实例内真实 GUI 会话注入正常      |
| 卸载   | `dsh plugin --profile web-183 remove dsh-my-opencode-session-header`           | exit 0；dump 中插件名与 loader id 均 0 次，重复扫描 0 条                                                                                      |
| 再启动 | 同命令重启                                                                     | HTTP 401 就绪，日志 0 `error` / 0 `duplicate`                                                                                                 |

### 验收第 7 条：临时解封的静态 header 已移除且功能仍正常 ✅

- `grep -n "x-opencode-session" ~/.dsh/settings.yaml` **无匹配**（issue 所述临时静态解封项已不在配置里）。
- 本轮全部真实调用（对照组 400 / 实验组 200、多轮、辅助调用、跨重启）都在**没有任何静态 header** 的前提下完成 → 功能由插件单独提供。

### 本轮未覆盖项（如实）

1. **压缩（compaction）未单独触发复跑**：以 `purpose: 'compaction'` 源码证据 + 与标题生成同走 `stream()` 的路径一致性 + 标题辅助调用真实取证外推，未做真实长会话触发压缩的抓包。
2. **未做 TLS 层中间人抓包**：方法注记已说明层级为 fetch 层全量请求头。
3. **其它 opencode 形态未覆盖**：仅验证 `openai-completions`（`opencode-go / deepseek-flash`）与 `deepseek-official` 两条路由；`anthropic-messages` 等未单独跑。
4. 复验后环境已按 skill 步骤 4 清理：端口 3099 释放（`curl` exit 7）、两个隔离 DSH_HOME 已删、无 `web-183` / `headless-183` 残留进程、验证浏览器已关闭、主实例 3080 全程未重启。

### 附录：本轮取证探针源码（fetch 层全量请求头）

仓库既有 `skills/verifying-dsh-plugins/scripts/fetch-probe.mjs` 只记录 `x-opencode-session` / `authorization` 两三项；本轮为做「其余头零变化」的字节级对照，用了它的全量头版本（放置于 `/tmp/dsh-183-verify/probe-full.mjs`，未入库）。语义与仓库探针一致：由 `NODE_OPTIONS=--import` 在 DSH 入口之前装载，包住当时最内层的 `globalThis.fetch` 后转调原实现。

```js
#!/usr/bin/env node
/**
 * probe-full.mjs — NODE_OPTIONS=--import 全量请求头探针（隔离验证专用，不随仓库提交）。
 * 记录每条匹配请求的 方法/URL/全部请求头（排序）/请求体摘要，用于：
 *  - issue #183 验收第2条：逐字节证明 x-opencode-session 存在且值 == 会话 id
 *  - issue #183 验收第4条：非 opencode 路由开/关插件请求头对照（字节级 diff）
 * 环境变量：PROBE_LOG（JSONL 路径）、PROBE_MATCH（URL 子串，空=全部）、PROBE_BODY_MAX
 */
import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const logPath = process.env.PROBE_LOG || '/tmp/probe-full.jsonl'
const match = process.env.PROBE_MATCH || ''
const bodyMax = Number(process.env.PROBE_BODY_MAX || '0')
const original = globalThis.fetch

globalThis.fetch = async function probedFetch(input, init) {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input))
  if (match === '' || url.includes(match)) {
    const rawHeaders = init?.headers ?? (typeof input === 'object' && input !== null ? input.headers : undefined)
    const headers = [...new Headers(rawHeaders).entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    const canonical = headers.map(([k, v]) => k + ': ' + v).join('\n')
    const record = {
      ts: new Date().toISOString(),
      method: init?.method ?? (typeof input === 'object' && input !== null ? input.method : undefined) ?? 'GET',
      url,
      headers,
      headerCount: headers.length,
      headerNames: headers.map(([k]) => k),
      hasSessionHeader: headers.some(([k]) => k === 'x-opencode-session'),
      sessionHeader: headers.find(([k]) => k === 'x-opencode-session')?.[1] ?? null,
      hasAuthorization: headers.some(([k]) => k === 'authorization'),
      headersSha256: createHash('sha256').update(canonical).digest('hex'),
      bodySha256:
        init?.body === undefined || init?.body === null
          ? null
          : createHash('sha256')
              .update(typeof init.body === 'string' ? init.body : String(init.body))
              .digest('hex'),
      bodyPrefix: bodyMax > 0 && typeof init?.body === 'string' ? init.body.slice(0, bodyMax) : undefined,
    }
    appendFileSync(logPath, JSON.stringify(record) + '\n')
  }
  return original.call(this, input, init)
}
```
