---
title: pi-ai 路由模型未收录报 needs an api
description: 网关新模型不在 pi-ai catalog 内时，llm-pi-ai 要求 route 显式声明 api，否则模型条目校验失败
created: 2026-09-10
updated: 2026-09-10
---

# pi-ai 路由模型未收录报 needs an api

> 状态：已定位并解决（2026-09-10，宿主配置问题，非本仓库插件缺陷）
> 场景：`~/.dsh/settings.yaml` 的 `llm-pi-ai.providers.<route>` 里手写了网关新模型

## 现象

保存模型配置或启动时报：

```
llm-pi-ai: provider "opencode-go" model "deepseek-flash" needs an api; the installed catalog
does not describe it, so set the route's api to the wire protocol its endpoint speaks
```

同一 route 里 catalog **已收录**的模型（如 `deepseek-v4-flash`）不报错，只有新增模型报错。

## 根因（三点叠加）

1. **模型清单不在 dsh 仓库**，随 `@earendil-works/pi-ai` 包发布（`dist/providers/data/*.json`）。dsh 的 rc 版本锁定的 pi-ai minor 落后于网关上新速度，新模型（`deepseek-flash`）不在安装的数据文件里 —— 「更新模型」按钮刷新的也是这份陈旧目录。
2. **`opencode-go` 是混合协议 catalog 路由**：pi-ai 0.85.1 中它同时含 `anthropic-messages`(2) / `openai-completions`(21) / `openai-responses`(4)。`sharedCatalogApi()` 只在 catalog 内所有模型 api 一致时才给出 route 级默认 api，混合协议 → 返回 undefined → 未收录模型没有兜底协议。
3. 配置里写 `models` 列表会**整体替换** catalog（不是追加），而替换后的每个条目仍能从 catalog 同 id 条目取 api/compat —— 所以"catalog 里有的不报错、新加的报错"。

判定代码：`dsh-llm-pi-ai/lib/index.js` 的 `resolveRouteModels` → `const api = request.api ?? base?.api ?? routeApi`。

## 解法（route 上显式声明 api）

```yaml
llm-pi-ai:
  providers:
    opencode-go:
      displayName: OpenCode Go
      api: openai-completions # 关键：catalog 未收录模型的兜底协议
      baseURL: https://opencode.ai/zen/go/v1
      apiKeyEnv: OPENCODE_GO_API_KEY
      headers:
        x-opencode-session: dsh-opencode-go-session # OpenCode Go 网关 2026-09 起强制，缺失即 400 MissingSessionID
      models:
        - id: deepseek-v4-flash # catalog 已收录，字段可省（这里保留是为了显式化）
          name: DeepSeek V4 Flash
          contextWindow: 1000000
          maxTokens: 384000
        - id: deepseek-flash # 网关有、catalog 没有 → 必须靠 route api 兜底
          name: DeepSeek Flash
          contextWindow: 1000000
          maxTokens: 384000
          reasoningEfforts:
            'off': null # off 用引号，避免与 YAML 布尔字面量产生解析分歧
            low: low
            high: high
            max: max
          compat:
            thinkingFormat: deepseek
            maxTokensField: max_tokens
            supportsStore: false
            supportsDeveloperRole: false
            requiresReasoningContentOnAssistantMessages: true
```

要点：

- `reasoningEfforts` **不声明**时该模型 `reasoning=false`（选择器没有思考档）；wire 取值建议对齐 catalog 内同族模型（本例抄 `deepseek-v4-flash` 的 compat/thinkingLevelMap）。
- `off` 档要真正关掉思考，**必须同时配 `compat.thinkingFormat: deepseek`**：该格式在 off 时下发 `thinking:{"type":"disabled"}`；若走 pi-ai 默认分支，off 只是"什么都不发"，而 DeepSeek 上游默认开思考 —— 表现为 off 档无效（实测：`disabled` → 响应无 `reasoning_content`；不发该字段 → 响应带 `reasoning_content`）。
- route 级 `api` 会作用于该 route 的**所有**手写条目；若同一 route 还要混合其它协议（如 anthropic-messages 的 `minimax-m3`），把 `api` 下沉到对应模型条目上。
- 改 `settings.yaml` 无需重启：llm-pi-ai 每次操作重读 settings；但 GUI 里**已经打开的编辑 draft** 要重新加载才会带上新值。
- `baseURL` 写 API 根（`.../v1`），不要写 `.../v1/chat/completions`，否则会被拼成 `.../chat/completions/chat/completions` → 404。

## 验证方式

- 协议层：直连网关 `POST {baseURL}/chat/completions`（带 `x-opencode-session`）→ 200；`thinking:{type:"enabled"}` 有 `reasoning_content`、`{type:"disabled"}` 没有。
- 配置层：用官方 schema 校验（`Config(section)`，来自 `@deepseek-ai/dsh-llm-pi-ai`）确认字段名/取值合法。
- 端到端：在 DSH GUI 里选中该模型真实发一条消息。
- 反证：删掉 `api:` 一行应复现原报错 —— 证明修复项就是必需项。

## 参考

- 官方同因讨论：[deepseek-harness#4856](https://github.com/deepseek-ai/deepseek-harness/discussions/4856)（GLM-5.3 拉不到；同族 #2330/#4042/#3752），其中给出另一条路：第三方插件 `dsh-model-sync` 从 pi.dev 网关同步模型目录进路由。
- catalog 陈旧相关讨论：[#3957](https://github.com/deepseek-ai/deepseek-harness/discussions/3957)
- 相关：`plugins/dsh-my-opencode-session-header`（为 opencode 出站请求注入 per-session 头，替代静态 header 值；2026-09-10 由 `dsh-opencode-session-header` 更名以避开第三方同名 npm 包）
