# dsh-mermaid-render

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="mermaid 代码块自动渲染为图表卡片（预览 / 代码切换）" src="https://unpkg.com/dsh-mermaid-render/assets/mermaid-card.png" width="360" />
</div>

**DSH 对话 Mermaid 图表渲染插件**：把对话消息里的 `mermaid` / `mmd` 代码块自动渲染成**图表卡片**（预览 / 代码切换）；mermaid 引擎随包分发、由 DSH webServer 静态托管，**不依赖任何 CDN**。

## 功能

- **自动渲染**：assistant 与 user 消息中的 mermaid 代码块自动变成图表卡片，无需手动操作。
- **默认提示模型主动画图**：host 半默认向系统提示词注入一段简短能力说明，因此用户不写「mermaid」字样（如只说「画一个登录流程图」）时模型也会主动输出 mermaid 代码块；可配 `injectPrompt: false` 关闭。
- **预览 / 代码切换 + 导出**：卡片工具栏可下载 PNG（SVG → canvas 2x 缩放）、下载 SVG、一键复制源码；导出失败在卡片内提示，不静默。
- **失败兜底**：渲染失败保留原始代码块，卡片内显示错误横幅 + 重试按钮；渲染一律走离屏容器，失败时引擎自带的错误图形随容器一起丢弃——页面上不会出现「炸弹图」。
- **流式兼容**：MutationObserver 跟随消息流式渲染，mermaid 块**闭合后即渲染**（不必等整条消息结束）；内容仍在增长时不渲染，已挂载后源码又变则自动卸载重来。
- **主题一致**：卡片样式走 DSH 语义 token，深浅主题自适应。

<div align="center">
  <img alt="用户只说「画一个登录流程的图」（不含 mermaid 字样）时，模型主动输出 mermaid 代码块并渲染为图表卡片" src="./assets/mermaid-auto-diagram.png" width="520" />
</div>

## 配置

| 配置项         | 默认   | 作用                                                                         |
| -------------- | ------ | ---------------------------------------------------------------------------- |
| `injectPrompt` | `true` | 是否向系统提示词注入 mermaid 能力说明；**仅显式 `false` 关闭**（非法值按开） |

关闭后不再注册系统提示词段，**client 端渲染不受影响**（已有 mermaid 代码块照常渲染，只是不再被主动引导）。非 web profile（headless / TUI，没有客户端渲染面）建议关闭：

```yaml
- id: mermaid-render
  config:
    injectPrompt: false
```

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-mermaid-render --trust-lockfile`——无需克隆本仓库；以下 link 方式供本仓库开发者使用。

```bash
# 1) 克隆本仓库（任意目录）
git clone https://github.com/baosfeng/my-dsh-plugins.git
# 2) 以本地 link 方式安装（将 <仓库路径> 替换为上面的克隆目录）
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-mermaid-render
```

装完后**重启 `dsh web`**（bundle 层在启动时组合），再硬刷新浏览器。与 [dsh-think-zh-expand](../dsh-think-zh-expand/README.md) 配合：该插件替换渲染器后仍产出 `md-code-block` 结构，本插件可直接识别。

## 已知限制

- 卡片为「预览 / 代码」两态，暂无缩放 / 全屏；引擎约 3.4 MB（`assets/mermaid-10.9.3.min.js`），由 webServer 静态托管、客户端首次渲染时 fetch，首次解析约 1–2 秒。
- 注入的能力说明描述的是 **web 端**行为：host 半无法感知 client 端是否可用，headless / TUI profile 请用 `injectPrompt: false`；注入文案目前为中文。
- 「零炸弹图」依赖「渲染到离屏容器 → 失败即丢弃容器」（当前引擎版本不支持 `suppressErrorRendering`），升级引擎后需重新验证错误语法与引擎不可用两条路径。
- 流式「闭合」判定是启发式（内容稳定窗口 400ms + 连续两次观察一致）：模型在代码块中间长时间停顿后继续写同一块时会先渲染再自愈重来，可能短暂闪动，但不会留下残缺卡片。

## 相关文档

→ [mermaid 渲染模块文档](../../docs/mermaid渲染/概述.md) · [CHANGELOG](CHANGELOG.md)
