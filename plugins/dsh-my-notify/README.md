# dsh-my-notify

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="远程触发通知：页面右下角 toast 卡片（通知权限未授予时的兜底呈现）" src="https://unpkg.com/dsh-my-notify/assets/notify-toast.png" width="640" />
</div>

**DSH 通知提醒插件**：在**会话结束**、**agent 询问问题**、**等待你批准**时发出**浏览器系统通知 / 页面 toast / 提示音**，点击通知直接跳转到对应会话；另提供**远程触发接口**与**出站 webhook**（企微 / 飞书 / 钉钉 / 通用中转，飞书支持 interactive 卡片）。通知文案按事件独立可配，模板支持 32 个变量。

## 功能

- **三类自动触发**（server，默认全开、可单独关闭）：`end` 本轮对话完成或被中断、`ask` agent 调用 `ask_user_question`、`approval` 出现待批准请求；同类事件同一会话 `dedupeMs` 内去重。
- **默认过滤子代理会话**（server）：只提醒直接查看的顶层会话；`subagentEnd: true` 后子代理完成也提醒。
- **文案模板**（server）：五类事件（`end` / `ask` / `approval` / `subagentEnd` / `remote`）各自 title / body 模板；单次扫描渲染，未识别占位符原样保留；空模板回退默认文案，远程触发显式 title / body 优先。
- **通道渲染**（server）：SSE 广播前统一渲染，系统通知与页面 toast 直接显示最终文本；webhook 按渠道组装 `text` / `markdown` / `post` / `interactive`。
- **飞书卡片**（server）：interactive 卡片 schema 2.0 / 1.0，按事件配色、字段区、跳转按钮、@提醒，正文超限按 UTF-8 截断并带续行提示。
- **呈现控制**（client）：系统通知、页面 toast（位置 / 时长 / 堆叠）、提示音（chime / drop / deep 三音色 + 音量 + 试听）；通知权限被拒时 toast 兜底。
- **设置页 v2**（client）：五分区（呈现 / 触发与时机 / 文案与变量 / 渠道推送 / 高级与安全）；文案工作台支持 5 事件独立标题正文 + 变量库点击插入 + 五形态实时预览；渠道抽屉含卡片设计器与 JSON 双态。
- **出站 webhook**（server）：多 webhook、按事件订阅、每条独立标题正文模板 / 卡片 / 重试；失败记录在设置页可见。
- **远程触发**（server）：`POST /notify/api/trigger` 受 loopback 信任围栏 + 可选 token 保护，任何本机进程、cron、CI、其他插件都能推送通知。

## 配置

`cordis.patch.yml` 对应插件行的 `config` 字段，均为可选；设置页保存写回同一份配置（webhooks 单独落 JSON）。坏字段逐项回退默认值，不整批拒绝。

### 触发与时机

| 配置键        | 默认                                        | 作用                                                         |
| ------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `end`         | `true`                                      | 会话结束提醒                                                 |
| `ask`         | `true`                                      | 询问提醒（正文取完整问题还是摘要见 `askMode`）              |
| `approval`    | `true`                                      | 审批提醒（事件摘要 + 工具名）                                |
| `subagentEnd` | `false`                                     | 子代理完成也提醒（标题带「子代理」前缀）                     |
| `askMode`     | `full`                                      | `full` 推送完整问题 / `summary` 只推摘要                    |
| `dedupeMs`    | `3000`                                      | 同类事件同会话去重窗口（毫秒）                               |
| `quietHours`  | `{enabled:false,start:'23:00',end:'08:00'}`  | 免打扰时段（`HH:mm`），命中时静默 SSE 与 webhook 两条通道     |
| `apiToken`    | `''`                                        | 远程触发 token；非空时 trigger 需带 `x-notify-token` 头     |
| `webBaseUrl`  | `''`                                        | DSH Web 地址；配置后生成会话链接（`session.url` / 卡片按钮） |

### 呈现（sound / toast / system）

| 配置键                    | 默认         | 作用                                                              |
| ------------------------- | ------------ | ----------------------------------------------------------------- |
| `sound.enabled`           | `true`       | 提示音开关（面板保存时与本地键 `dsh-notify:sound` 双写）         |
| `sound.preset`            | `chime`      | 音色 `chime` / `drop` / `deep`（改选时同步写 `dsh-notify:tone`） |
| `sound.volume`            | `0.6`        | 音量 0–1（面板保存时与本地键 `dsh-notify:volume` 双写）          |
| `toast.enabled`           | `true`       | 页面 toast 开关                                                   |
| `toast.durationMs`        | `4000`       | 单条停留时长（1000–60000）                                        |
| `toast.position`          | `top-right`  | `top-right` / `top-left` / `bottom-right` / `bottom-left` / `top` / `bottom` |
| `toast.maxStack`          | `3`          | 最大堆叠条数（1–10，超出移除最旧）                                |
| `system.enabled`          | `true`       | 系统通知开关（进设置页时播种到 `dsh-notify:notify`）             |
| `system.requireInteraction` | `false`      | 系统通知常驻开关（构造 `Notification` 时传入）                    |

服务端默认值与客户端实播音色一致（`chime`）；首次进设置页时把 `system`/`sound`/`toast` 配置播种到本地键（只写缺失键，不覆盖现场选择）。

### 文案（messages）

`messages.<事件>.{title,body}` 覆盖默认文案；写空串/非字符串回退默认值。

| 事件键        | 默认 title           | 默认 body            |
| ------------- | -------------------- | -------------------- |
| `end`         | `{{session.title}}`  | `{{event.note}}`     |
| `ask`         | `{{session.title}}`  | `{{ask.summary}}`    |
| `approval`    | `{{session.title}}`  | `{{approval.reason}}` |
| `subagentEnd` | `{{session.title}}`  | `{{event.note}}`     |
| `remote`      | `{{session.title}}`  | `{{event.note}}`     |

### 出站 webhook（`webhooks[]`）

| 配置键            | 默认      | 作用                                                              |
| ----------------- | --------- | ----------------------------------------------------------------- |
| `name`            | 必填      | webhook 名称（失败记录里显示）                                    |
| `url`             | 必填      | 机器人 / 中转地址                                                 |
| `channel`         | `generic` | `wecom` / `feishu` / `dingtalk` / `generic`（决定格式化与加签）  |
| `secret`          | `''`      | 加签密钥；加签时间戳为**秒级**                                    |
| `events`          | `[]`      | 订阅事件（`end` / `ask` / `approval` / `subagentEnd` / `remote`），空 = 全部 |
| `enabled`         | `true`    | 该条是否启用                                                      |
| `msgType`         | `text`    | 企微 / 钉钉 `text`·`markdown`；飞书 `text`·`post`·`interactive`；generic 恒 `text` |
| `template`        | `''`      | 旧版整段正文模板（`bodyTemplate` 未配置时生效）                  |
| `titleTemplate`   | `''`      | 标题模板，渲染为空时回退通知标题                                  |
| `bodyTemplate`    | `''`      | 正文模板，未配置时用渠道默认富格式正文                            |
| `retry.attempts`  | `3`       | 失败重试次数（配置 0–10；设置页保存夹到 0–5）                      |
| `retry.backoffMs` | `1000`    | 退避基数（100–60000，按指数增长）                                 |

飞书 `msgType: interactive` 时的 `card`：

| 配置键                  | 默认      | 作用                                                          |
| ----------------------- | --------- | ------------------------------------------------------------- |
| `card.schemaVersion`    | `2.0`     | 卡片结构 `2.0` / `1.0`                                         |
| `card.template`         | `''`      | 头部配色（13 色之一）；空/非法按事件配色                        |
| `card.fields`           | `[]`      | 字段区（≤10 项）；短键 `token` / `duration` / `tool` / `question` / `link` 或变量全名 |
| `card.buttonText`       | `''`      | 跳转按钮文案（与 `session.url` 同时存在才出按钮）              |
| `card.mentionOpenIds`   | `[]`      | @ 的 open_id / user_id（≤20 项，空项与非 id 形态自动剥离）       |
| `card.mentionAll`       | `false`   | 追加 `@所有人`                                               |
| `card.accentByKind`     | `true`    | 按事件自动配色（`end` 绿 / `ask` 蓝 / `approval` 橙 / 子代理紫 / `remote` 灰） |

## 变量

模板占位符写 `{{namespace.var}}`（32 个，分 7 组）；旧写法 `{var}` 仍生效。未识别的占位符原样保留，变量缺值渲染为空串。

| 分组 | 变量 | 说明 |
| ---- | ---- | ---- |
| 会话 | `session.title` `session.id` `session.url` `session.cwd` `session.model` `session.provider` `session.agentLevel` `session.parentId` `session.preset` `session.durationSeconds` `session.durationText` | 标题 / 链接（需 `webBaseUrl`）/ 工作目录 / 模型 / 层级（顶层·子代理）/ 耗时 |
| 事件 | `event.kind` `event.name` `event.note` `event.time` | 事件原值 / 中文名 / 摘要 / 时间（`YYYY-MM-DD HH:mm`） |
| 提问 | `ask.question` `ask.summary` `ask.count` | 完整问题 / 摘要（首行 ≤80 字）/ 问题数 |
| 工具 | `tool.name` | 触发审批的工具名 |
| 审批 | `approval.reason` `approval.reasonLocalized` | 宿主原文 / 本地化文本（无翻译时同值） |
| Token | `tokens.input` `tokens.output` `tokens.total` `tokens.cacheRead` `tokens.cacheWrite` `tokens.reasoning` `tokens.requests` `tokens.text` | 各分项数值 / 综合文本（无数据为「不可用」） |
| 通知自身 | `notify.channel` `notify.channelName` `notify.pluginVersion` | 渠道标识 / 渠道中文名 / 插件版本 |

旧别名（同值，建议迁到新语法）：`{title}`→`session.title` · `{kind}`→`event.name` · `{note}`→`event.note` · `{tokens}`→`tokens.text` · `{question}`→`ask.question` · `{sessionUrl}`→`session.url` · `{time}`→`event.time`。

## 飞书卡片

- **版本**：默认 schema 2.0（元素在 `body.elements`）；`card.schemaVersion: '1.0'` 输出 `config` + 顶层 `elements`。
- **结构**：header（标题 + 配色）→ @ 行 → 正文 → 字段区（`**标签**：值` 每项一段）→ 跳转按钮（`open_url`）→ 时间注脚（事件名 · 时间）。
- **配色**：13 色白名单；空/非法且 `accentByKind` 为真时按事件配色，否则 `default`。
- **@ 限制**：飞书只支持 open_id / user_id，含空白或 `<>=&` 的项、超 64 字符的项一律剥离；全部为空时不生成 @ 行。
- **体积限制**：整卡 JSON 按 UTF-8 计，超 19600 字节时截断正文并追加续行提示（有 `session.url` 时提示「完整内容见会话链接」）；元素上限 200、字段上限 10。
- **预览**：设置页卡片设计器调用 `POST /notify/api/preview` 实时出卡，可在「设计器 / JSON」双态间切换。

## 接口

均需通过 loopback 信任围栏（非本机来源 403）。

- `POST /notify/api/trigger`：body `{title, body, sessionId?}`，`apiToken` 非空时带 `x-notify-token`；推送 `kind: remote` 通知，显式 title / body 不被 `messages.remote` 模板覆盖。
- `GET /notify/api/variables`：返回变量目录 `{ok, value: [{group, label, items: [{name, description, example}]}]}`，设置页变量库据此渲染。
- `POST /notify/api/preview`：body `{kind?, channel?, sample?, titleTemplate?, bodyTemplate?, template?, card?}`（`kind` 取 5 类事件、`channel` 取 4 渠道、`sample` 按通知帧字段覆盖样例），返回 `{ok, value: {card, text, vars}}`——`card` 为飞书卡片 JSON、`text` 为该渠道正文、`vars` 为本次渲染的变量快照。

## 页面内开关（localStorage）

运行时闸门在读服务端配置的同时接受本地覆盖，**只有下列内容存 localStorage**，其余都是 config 字段：

| 键 | 默认 | 说明 |
| -- | ---- | ---- |
| `dsh-notify:notify` | `1` | 系统通知总开关；面板「系统通知」开关同时写 `system.enabled` 与本键 |
| `dsh-notify:sound` | `1` | 提示音开关；面板同时写 `sound.enabled` |
| `dsh-notify:toast` | `1` | 页面 toast 开关；面板同时写 `toast.enabled` |
| `dsh-notify:volume` | `0.6` | 提示音音量 0–1（面板滑杆只写本地，不改配置） |
| `dsh-notify:tone` | `chime` | 音色 `chime` / `drop` / `deep`；面板改选时与 `sound.preset` 同时写 |
| `dsh-notify:dedupe:<kind>:<sessionId>` | — | 客户端 2 秒去重时间戳（自动写，配合 Web Locks 跨标签页互斥） |

进设置页时若上述本地键**不存在**，按当前配置播种；已存在的键视为现场选择，不被覆盖。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-my-notify --trust-lockfile`——无需克隆本仓库；以下 link 方式供本仓库开发者使用。依赖 `dsh-shared` 随 npm 自动安装。

```bash
# 1) 克隆本仓库（任意目录）
git clone https://github.com/baosfeng/my-dsh-plugins.git
# 2) 以本地 link 方式安装（将 <仓库路径> 替换为上面的克隆目录）
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-notify
```

- server 端改动需重启 `dsh web`；client 端改动浏览器硬刷新即可。

## 行为与边界

- **通知权限**：浏览器首次收到通知时发起权限请求；拒绝后自动用页面内 toast 兜底。
- **自动播放策略**：提示音需用户与页面有过至少一次交互（点击 / 按键）后才能发声，属浏览器安全限制。
- **SSE 会话**：多标签页同时打开时全部收到通知（同一帧只由一个标签页弹窗 + 响铃）；EventSource 断线 3s 自动重连。
- **配置获取失败**：toast 位置 / 时长 / 堆叠回退 `bottom-right` / 4s / 3 条，不影响通知本身。
- **免打扰与去重**：免打扰命中时 SSE 与 webhook 一并静默；webhook 失败不改动通知帧，只记失败记录。

## 相关文档

→ [通知提醒模块文档](../../docs/通知提醒/概述.md) · [CHANGELOG](CHANGELOG.md) · [面板 v2 原型](../../docs/原型重构/dsh-my-notify-v2.html)
