# dsh-my-opencode-session-header

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

> **无 UI 说明**：本插件是纯 server 插件（无 client / 无面板 / 无设置页），**不产生界面截图**——README 效果图门禁按 `package.json` 的 `dsh.ui=false` + `dsh.uiReason` **显式豁免**（issue #227）。生效证据（真实出站请求头）见下文 [验证是否生效](#验证是否生效) 一节。

**DSH opencode 会话头注入插件**：让走 `opencode` / `opencode-go` 路由的推理请求自动携带
`x-opencode-session`（该会话的稳定 id），修复 OpenCode Go 网关自 2026-09-05 起对缺失该头的请求返回
**400 MissingSessionID** 的问题。

- 上游 discussion：<https://github.com/deepseek-ai/deepseek-harness/discussions/5495>
- 形态：纯 server 插件（`llm/stream` 事件包装 + `globalThis.fetch` 单层补丁），零运行时依赖。

## 问题背景

OpenCode Go 网关（`https://opencode.ai/zen/go`）要求每个推理请求携带 `x-opencode-session`（该会话的稳定 id），
否则返回 `400 MissingSessionID`。而 DSH 的 pi-ai 适配器只发 `x-client-request-id` / `x-session-affinity` /
`session_id`，**从不发** `x-opencode-session`，因此 DSH 走 opencode-go 的模型必然 400（已用真实 key 实测：
无头 400、带头 200）。

纯配置**不可行**，两条路都被堵死：

1. `dsh-llm-pi-ai` 的 `headers` 是静态字符串字典（无插值），无法填入"当前会话 id"；
2. pi-ai 的 session 头名写死，DSH 把 `sessionAffinityFormat` / `sendSessionAffinityHeaders` 标为 withhold
   （写进 settings 直接报错）。

唯一可用拦截点就是本插件采用的 `llm/stream` waterfall + `globalThis.fetch` 补丁。

## 工作原理

```
DSH agent loop
  └─ ctx.waterfall(ctx, 'llm/stream', options, () => adapterStream(...))
       options: { provider: 'opencode-go', sessionId: '<会话 id>', … }
       ↓ 本插件 handler（同步函数，绝不 async）
       ① 同步取到内层流；
       ② 用 AsyncLocalStorage 存 { provider, 会话头值 }；
       ③ 返回包装流：每次 next()/return() 都在 als.run(store, …) 内执行
          （pi-ai 的 Models.streamSimple() 是惰性的，真正的 HTTP 发生在消费流时）
       ↓ 消费流 → pi-ai → openai / anthropic SDK
  SDK 每次请求解析 globalThis.fetch
       ↓ 本插件安装的单层 fetch 补丁
       ④ 路由判定（AND）：provider ∈ 白名单 且 目标 host 命中配置 → 注入头
          任一不满足 / 无会话上下文 / 任何异常 → 原样调用原 fetch（零副作用）
```

要点：

- **不改 `options`**（可能被冻结），只包装流；
- **会话头值确定性**：同一会话在跨轮次 / 压缩摘要 / 重试 / 重启后得到**同一个值**，不同会话不同值
  （纯函数，无状态无随机）；
- **幂等**：请求里已存在同名头（`Headers` 实例 / 数组 / 普通对象三种形态，大小写不敏感）时默认**不覆盖**，
  `override: true` 时才覆盖；
- **退化安全**：无 ALS 上下文或会话 id 为空时**不注入**（首次出现时 warn 一次，之后静默）；插件内部任何异常
  都被吞掉并降级为原行为，**绝不影响推理请求**；
- **卸载干净**：`disposer` 仅在"当前 `globalThis.fetch` 仍是我们装的那个"时还原，不误还原他人的 patch；
- 会话标题生成、压缩摘要等**辅助 LLM 调用**同样经过 `llm/stream`，也会带上同一会话的会话头。

## 配置项

| 配置项       | 默认值                        | 说明                                                                  |
| ------------ | ----------------------------- | --------------------------------------------------------------------- |
| `enabled`    | `true`                        | 总开关（`false` 不注册监听、不装 fetch 补丁）                         |
| `providers`  | `["opencode", "opencode-go"]` | provider 路由白名单（空数组 / 非法值启动即报错）                      |
| `hosts`      | `["opencode.ai"]`             | 目标主机白名单，自动含子域（`zen.opencode.ai` 命中 `opencode.ai`）    |
| `headerName` | `"x-opencode-session"`        | 注入的请求头名                                                        |
| `valueMode`  | `"uuid"`                      | `uuid` = 提取会话 id 中的裸 UUID（无则回退原串）；`raw` = 原始会话 id |
| `override`   | `false`                       | 已有同名头时是否覆盖                                                  |

配置示例（profile 的 `cordis.patch.yml`）：

```yaml
- id: opencode-session-header
  config:
    enabled: true
    providers: ['opencode', 'opencode-go']
    hosts: ['opencode.ai']
    valueMode: uuid
    # override: true   # 仅当确有需要覆盖已有同名头时才开启
```

## 安装

```bash
# 方式一：npm 安装（发布后）
dsh plugin --profile web add dsh-my-opencode-session-header

# 方式二：本地 link 安装（开发中）
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-opencode-session-header
```

> ⚠️ **与第三方同名包区分（2026-09-10 核查）**：npm registry 上已有他人发布的
> `dsh-opencode-session-header@0.1.0`（npm 用户 `beihaizb`，仓库 `github.com/beihzb/dsh-opencode-session-header`，
> 功能同为给 OpenCode Go 注入 per-conversation 会话头）——**那不是本插件**。本仓库的包名是
> **`dsh-my-opencode-session-header`**（`my-` 前缀即用于与之区分，见 issue #183），目前**尚未发布 npm**；
> 开发期请用上面的「方式二」`link:` 安装，上面「方式一」的 npm 安装串在发布后可用。

> ⚠️ **安装后必须完全重启 `dsh`（Web 服务）才生效**：插件是在启动时注册 `llm/stream` 监听并安装
> `globalThis.fetch` 补丁的，仅刷新浏览器页面不生效。

安装前请先完成下面「与静态 header 解封互斥」一节的清理，否则插件默认不会覆盖静态值、等于没生效。

## 与静态 header 解封互斥（重要）

若你此前用过"静态 header 解封"绕过 400，即 `settings.yaml` 里给 opencode-go 配了**写死的**
`x-opencode-session`，请**删除该项**——静态值会一直在请求里出现，而本插件默认
`override: false` 不覆盖已有头，结果是静态值继续生效、插件不生效（且静态值是**所有会话共用的固定值**，
网关侧会把不同会话当成同一个会话）。

需要删除的配置片段形如（`~/.dsh/settings.yaml`，以实际结构为准）：

```yaml
llm-pi-ai:
  providers:
    opencode-go:
      baseURL: https://opencode.ai/zen/go/v1
      headers:
        x-opencode-session: dsh-opencode-go-session # ← 删除这一行（连同 headers: 若为空）
```

删除后完全重启 `dsh`。若因故必须保留静态头、又想让插件接管，可改用 `override: true`。

## 验证是否生效

### 1. 看启动日志（必须出现这一行）

完全重启 `dsh` 后，启动日志里应出现**原文**：

```
[opencode-session-header] active for providers [opencode, opencode-go] with valueMode uuid
```

没有这一行说明插件没挂载（检查 `dsh plugin list` / profile 的 `cordis.patch.yml`），
或配置校验失败（非法配置会在启动时报 `[opencode-session-header] config.xxx …`）。

### 2. 不依赖抓包的自证

1. 重启后确认上一节的启动日志出现；
2. 另确认 `settings.yaml` 里的静态 `x-opencode-session` 已删除；
3. 新开一个**走 opencode-go 路由**的会话（模型/provider 选 opencode-go），随便发一条消息；
4. **会话正常回复、不再出现 `400 MissingSessionID`** → 插件生效；
5. 再开第二个会话发消息，同样正常 → 不同会话各自携带自己的会话 id（若两个会话会互相干扰/串上下文，
   说明仍在用静态头，回到第 2 步）。

### 3. 带证据的确认（可选）

因为走的是 HTTPS，`tcpdump` 看不到明文的请求头；要看**实际发出的值**，用下面两条路之一：

**方式 A：临时把 baseURL 指向本机记录器**（最省事，不装任何东西）

```bash
cat > /tmp/header-probe.mjs <<'EOF'
import { createServer } from 'node:http'
createServer((req, res) => {
  console.log(new Date().toISOString(), req.method, req.url, 'x-opencode-session=', req.headers['x-opencode-session'])
  res.writeHead(400, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'probe only' } }))
}).listen(8799, '127.0.0.1', () => console.log('probe on http://127.0.0.1:8799'))
EOF
node /tmp/header-probe.mjs
```

然后临时把 `settings.yaml` 里 `llm-pi-ai.providers.opencode-go.baseURL` 改成 `http://127.0.0.1:8799/v1`，
重启 `dsh` 并发一条消息：终端会打印该请求的 `x-opencode-session=` 值。判读标准：

- 同一会话多次请求打印的值**完全相同**（跨轮次稳定）；
- 换一个会话后打印的值**不同**；
- `valueMode: uuid` 时打印的是裸 UUID（如 `9f8e7d6c-5b4a-4392-8170-0a1b2c3d4e5f`）。

验证完把 `baseURL` 改回 `https://opencode.ai/zen/go/v1` 并重启（本插件**不需要**保留任何静态头）。

**方式 B：MITM 代理**（mitmproxy / Charles 等），让 `dsh` 的 HTTPS 请求经代理，查看 `x-opencode-session`
请求头（需信任代理证书）。

## 卸载

```bash
dsh plugin --profile web remove dsh-my-opencode-session-header
```

然后**完全重启 `dsh`**。卸载后 `globalThis.fetch` 由插件的 disposer 还原为安装前的实现（仅还原自己装的那层）。

## 已知限界

- 只拦截 `globalThis.fetch`：若某 provider 的 `transport` 走 websocket 或绕过 fetch 的原生客户端，
  本插件不注入（opencode-go 走 HTTPS fetch，不受影响）。
- 只在 `llm/stream` 上下文内注入：DSH 里其它（非推理）的 fetch 调用不会被加头。
- 与静态 `headers` 配置互斥（见上）；静态值优先，除非 `override: true`。
- `valueMode: uuid` 在会话 id 不含 UUID 时回退为原始会话 id 字符串（仍确定性、会话间唯一）。

## 开发与测试

```bash
cd plugins/dsh-my-opencode-session-header
npm test          # vitest（含覆盖率门禁）+ cucumber Gherkin 验收
npm run typecheck # tsc --noEmit
npm run build     # src/*.ts → lib/*.js（产物需提交）
```

测试覆盖：opencode 路由注入正确值 / 非 opencode provider 与 host 不注入 / 无会话 id 退化 /
已有头幂等与 `override` 覆盖（三种头形态）/ 并发会话不串号 / 流 `return()` 透传（early break）/
disposer 还原 fetch 且不误还原他人 patch / `valueMode` uuid 与 raw / 配置校验报错 / `Request` 形态 input /
不可解析 URL 与非流对象降级。

## License

MIT
