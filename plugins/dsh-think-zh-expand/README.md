# dsh-think-zh-expand

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="思考块默认展开并渲染 Markdown 与 Mermaid 图表" src="https://unpkg.com/dsh-think-zh-expand/assets/think-markdown.png" width="340" />
</div>

**DSH 思考增强插件**：让 agent 的思考（reasoning）与回复强制使用中文，对话里的思考内容**默认展开显示**（替代内置的单行折叠），并把界面残留的硬编码英文（Thinking / Tool Call 等）**中文化**。

## 功能

- **思考强制中文**（server 端）：经 `systemPrompt.section` 注入一条最高优先级的语言规则——思考过程必须简体中文、最终回复跟随用户语言；英文错误信息与英文上下文不改变语言，代码、命令、路径、术语保持原文。
- **思考默认展开**（client 端）：覆盖 `conversation.chat.node` 的 `assistant-step` 渲染器，思考内容完整显示、点击标题行可收起（流式生成中强制展开），并同样走 Markdown 渲染（代码块 / 表格 / 公式 / **Mermaid 图表**）。
- **界面标签中文化**（client 端）：只替换「完全等于」词表的叶子文本节点（`Thinking`→`思考`、`Tool Call`→`工具调用` 等），排除代码块与输入区，不误伤消息正文与代码；工具卡片与工具目录的工具名同步中文化，未覆盖的保留英文。

Markdown 渲染组件按三级回退解析：装了 [dsh-md-render](../dsh-md-render/README.md) 就用它；未装时用宿主官方 `MarkdownText`（**开箱即可渲染**，少的是表格容错、代码块增强等）；极旧宿主回退纯文本 `<pre>`，渲染期始终不抛错。

## 安装

```bash
# npm 安装（推荐；dsh-md-render 可选，装了获得增强 Markdown 渲染）
dsh plugin --profile web add dsh-think-zh-expand dsh-md-render --trust-lockfile

# 本地 link（本仓库开发者）
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-think-zh-expand
```

- server 端改动需重启 `dsh web`；client 端改动浏览器硬刷新（Cmd/Ctrl+Shift+R）即可。

## 配置

| 配置项            | 类型    | 默认值 | 说明                                                                                                                                     |
| ----------------- | ------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultExpanded` | boolean | `true` | 思考块**展开初值**。`true`（默认）= 保持本插件的产品定位「思考默认展开」；`false` = 初始折叠，流式生成中仍自动展开、**生成完成后收起**。 |

在 profile patch 的插件行里显式声明（`~/.dsh/profiles/<profile>.patch.yml`）：

```yaml
- insert:
    - id: think-zh-expand
      name: 'dsh-think-zh-expand'
      config:
        defaultExpanded: false # 想要「流式展开 → 完成收起」就设为 false
```

- 缺失该配置、值非布尔、或**配置读取通道不可用**（非 web 宿主、路由未注册）时，一律回退 `true` —— 配置面永远不会让插件从「默认展开」静默变成「默认折叠」。
- 读取通道：host 半边经 `webServer` 注册只读路由 `GET /think-zh-expand/api/config`（仅 loopback 可读），client 半边在渲染前拉取该值作为展开初值。

## 相关文档

→ [思考增强概述](../../docs/思考增强/概述.md) · [CHANGELOG](CHANGELOG.md)
