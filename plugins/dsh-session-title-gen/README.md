# dsh-session-title-gen

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<!-- 效果图占位：发版前用 verifying-dsh-plugins 隔离实例 + 真实浏览器截图，存 assets/ 并替换本注释 -->

**DSH 会话标题自动生成插件**：监听会话首条人类消息，用 LLM 生成类似 git commit 的**结构化标题**——先标明当前会话属于哪个（工作区/项目），再写一段简要描述，如 `[my-dsh-plugins] 修复 #143 记忆页签崩溃`。会话列表一眼可辨归属与主题。

## 功能

### 1. 结构化标题自动生成（先归属后描述）

- 新会话**首条人类消息**后自动生成结构化标题：`[工作区名] 简要描述`（类似 git commit 的 `type(scope): description`）；
- **工作区名** = 会话工作目录的项目根 basename（向上找最近 `.git` 祖先，复用 dsh-shared 的 `findProjectRoot`）；
- **简要描述** = LLM 根据首条消息生成（system prompt 强制 `[workspace] description` 单行格式，语言跟随消息）；
- 经 DSH 核心 `session/title` 事件写入（log-backed），**重启后标题保留**，DSH 原生会话列表与 observability 面板均显示新标题。

### 2. 与核心标题机制的协作（失败自动回退）

- DSH 核心 bundle 已注册唯一标题 provider（`session-title-first-prompt-llm`），本插件**不注册 provider**，直接 append `session/title` 事件覆盖（fold 取最后一个事件）；
- 核心 fallback / provider 生成的非结构化标题（如"请你帮我修改一下处理 iss..."）会触发本插件**重新生成**（监听 `session/title` 事件兜底竞态）；
- **生成失败不阻塞会话**：LLM 不可用 / 超时 / 输出为空时静默回退，核心标题机制照常工作；
- **尊重用户手动标题**：用户手动重命名的标题（source: user）不被覆盖。

### 3. 可配置

| 配置项            | 默认值                        | 说明                                             |
| ----------------- | ----------------------------- | ------------------------------------------------ |
| `enabled`         | `true`                        | 总开关（`false` 完全关闭，不监听任何事件）       |
| `template`        | `[{workspace}] {description}` | 格式模板（`{workspace}` / `{description}` 占位） |
| `provider`        | （缺省）                      | LLM provider 覆盖（缺省用会话请求路由）          |
| `model`           | （缺省）                      | LLM model 覆盖（缺省用会话请求路由）             |
| `maxTitleBytes`   | `80`                          | 标题 UTF-8 字节上限（与核心一致）                |
| `maxInputBytes`   | `4096`                        | 送入 LLM 的消息 JSON 字节上限                    |
| `maxOutputTokens` | `64`                          | LLM 输出 token 上限                              |
| `timeoutMs`       | `30000`                       | LLM 调用超时（超时静默回退）                     |

## 安装

```bash
# 方式一：npm 安装（发布后）
dsh plugin --profile web add dsh-session-title-gen

# 方式二：本地 link 安装（开发中）
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-session-title-gen
```

## 配置示例

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: session-title-gen
  config:
    enabled: true
    template: '[{workspace}] {description}'
    # provider: deepseek
    # model: deepseek-chat
```

## 工作原理

```
用户首条消息 ──► session/event (user/message)
                    │
                    ▼
        解析工作区名（cwd → findProjectRoot → basename）
                    │
                    ▼
        LLM 生成描述（ctx.llm.stream，system 强制 [workspace] 格式）
                    │
                    ▼
        session.append("session/title", { title, source: { kind: "provider", provider: "dsh-session-title-gen" } })
                    │
                    ▼
        会话列表（DSH 原生 + observability）显示结构化标题（重启保留）
```

核心生成的非结构化标题（fallback / provider）→ 触发 `session/title` 事件 → 本插件重新生成覆盖。

## 文档

- [模块文档](../../docs/会话标题自动生成/概述.md) — 业务场景映射与设计说明
- [需求清单](../../docs/会话标题自动生成/需求清单.md) — 需求对照基准（开发/修改前必读）

## License

MIT
