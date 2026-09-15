# dsh-my-opencode-session-header

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

> **无 UI 说明**：纯 server 插件（无 client / 无面板 / 无设置页），不产生界面截图——README 效果图门禁按 `package.json` 的 `dsh.ui=false` + `dsh.uiReason` 显式豁免。

**DSH OpenCode 会话头注入插件**：让走 `opencode` / `opencode-go` 路由的推理请求自动携带 `x-opencode-session`（该会话的稳定 id），修复 OpenCode Go 网关对缺失该头的请求返回 **400 MissingSessionID** 的问题。上游讨论：<https://github.com/deepseek-ai/deepseek-harness/discussions/5495>。

## 功能与边界

- 包装 `llm/stream` 事件 + 单层补丁 `globalThis.fetch`，命中配置的 provider 与目标 host 时注入会话头，零运行时依赖。
- **确定性**：同一会话在跨轮次 / 压缩摘要 / 重试 / 重启后得到同一个值，不同会话不同值；辅助 LLM 调用（标题、摘要）同样带上同一会话的头。
- **幂等**：请求里已存在同名头（`Headers` / 数组 / 普通对象三种形态，大小写不敏感）时默认不覆盖，`override: true` 才覆盖。
- **退化安全**：无会话上下文 / 会话 id 为空 / 插件内部异常 → 不注入，原样放行，绝不影响推理请求。
- **卸载干净**：disposer 仅在「当前 `globalThis.fetch` 仍是自己装的那层」时还原，不误还原他人的 patch。

## 配置项

| 配置项       | 默认值                        | 说明                                                                |
| ------------ | ----------------------------- | ------------------------------------------------------------------- |
| `enabled`    | `true`                        | 总开关（`false` 不注册监听、不装 fetch 补丁）                       |
| `providers`  | `["opencode", "opencode-go"]` | provider 路由白名单（空数组 / 非法值启动即报错）                    |
| `hosts`      | `["opencode.ai"]`             | 目标主机白名单，自动含子域（`zen.opencode.ai` 命中 `opencode.ai`）  |
| `headerName` | `"x-opencode-session"`        | 注入的请求头名                                                      |
| `valueMode`  | `"uuid"`                      | `uuid` = 取会话 id 中的裸 UUID（无则回退原串）；`raw` = 原始会话 id |
| `override`   | `false`                       | 已有同名头时是否覆盖                                                |

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
# 方式一：npm 安装
dsh plugin --profile web add dsh-my-opencode-session-header

# 方式二：本地 link 安装（开发中）
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-opencode-session-header
```

安装后必须**完全重启 `dsh`（Web 服务）**才生效：插件在启动时注册 `llm/stream` 监听并安装 fetch 补丁，只刷新浏览器不生效。

> **与静态 header 互斥（重要）**：若 `settings.yaml` 里给 opencode-go 配了写死的 `x-opencode-session`，请先删除该项——本插件默认 `override: false` 不覆盖已有头，静态值会让插件形同未启用，且该固定值会被网关当成同一个会话。确需保留静态头又要插件接管时，改用 `override: true`。

## 验证是否生效

1. 完全重启 `dsh`，启动日志应出现 `[opencode-session-header] active for providers […] with valueMode uuid`；没有则插件未挂载（查 `dsh plugin list` / `cordis.patch.yml`）或配置校验失败。
2. 新开一个走 opencode-go 路由的会话发消息：正常回复、不再出现 400 即为生效；再开第二个会话同样正常，说明两个会话各带自己的 id（互相串上下文说明仍在用静态头）。
3. 需要看实际发出的头值时，可临时把 `settings.yaml` 的 `llm-pi-ai.providers.opencode-go.baseURL` 指向本机一个打印请求头的 HTTP 服务（HTTPS 下 `tcpdump` 看不到明文），验证完改回原地址并重启。

## 卸载

```bash
dsh plugin --profile web remove dsh-my-opencode-session-header
```

卸载后完全重启 `dsh`，`globalThis.fetch` 由 disposer 还原为安装前的实现（仅还原自己装的那层）。

## 已知限界

- 只拦截 `globalThis.fetch` 且只在 `llm/stream` 上下文内注入：走 websocket / 绕过 fetch 的原生客户端、其它非推理 fetch 调用都不加头（opencode-go 走 HTTPS fetch，不受影响）。
- 与静态 `headers` 配置互斥（见上）：静态值优先，除非 `override: true`。
- `valueMode: uuid` 在会话 id 不含 UUID 时回退为原始会话 id 字符串（仍确定性、会话间唯一）。

## 相关文档

→ [OpenCode 会话头模块文档](../../docs/OpenCode会话头/概述.md) · [CHANGELOG](CHANGELOG.md)
