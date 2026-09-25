# my-dsh-plugins

[![npm version](https://img.shields.io/npm/v/my-dsh-plugins.svg?style=flat-square)](https://www.npmjs.com/package/my-dsh-plugins)
[![CI](https://github.com/baosfeng/my-dsh-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/baosfeng/my-dsh-plugins/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/baosfeng/my-dsh-plugins/badge.svg?branch=main)](https://coveralls.io/github/baosfeng/my-dsh-plugins?branch=main)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2022-brightgreen.svg)](https://nodejs.org/)
[![CodeQL](https://github.com/baosfeng/my-dsh-plugins/actions/workflows/codeql.yml/badge.svg)](https://github.com/baosfeng/my-dsh-plugins/actions/workflows/codeql.yml)

**个人 DSH（DeepSeek Harness）插件集合仓库**：轻量多插件目录，每个插件位于 `plugins/<name>/`，自包含、可独立安装与发布。

<div align="center">
  <table>
    <tr>
      <td align="center" style="vertical-align:top"><img src="plugins/dsh-file-activity/assets/screenshot.png" width="230" alt="dsh-file-activity 文件活动侧边栏" /></td>
      <td align="center" style="vertical-align:top"><img src="plugins/dsh-think-zh-expand/assets/think-markdown.png" width="230" alt="dsh-think-zh-expand 思考块渲染" /></td>
      <td align="center" style="vertical-align:top"><img src="plugins/dsh-mermaid-render/assets/mermaid-card.png" width="230" alt="dsh-mermaid-render 图表卡片" /></td>
      <td align="center" style="vertical-align:top"><img src="plugins/dsh-my-notify/assets/notify-toast.png" width="230" alt="dsh-my-notify 通知提醒 toast" /></td>
      <td align="center" style="vertical-align:top"><img src="plugins/dsh-task-reliability/assets/screenshot-panel.png" width="230" alt="dsh-task-reliability 任务可靠性面板" /></td>
    </tr>
    <tr>
      <td align="center"><sub>dsh-file-activity</sub></td>
      <td align="center"><sub>dsh-think-zh-expand</sub></td>
      <td align="center"><sub>dsh-mermaid-render</sub></td>
      <td align="center"><sub>dsh-my-notify</sub></td>
      <td align="center"><sub>dsh-task-reliability</sub></td>
    </tr>
  </table>
</div>

## 插件列表

| 插件                                                                               | 版本   | 简介                                                                                          |
| ---------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| [dsh-file-activity](plugins/dsh-file-activity/README.md)                           | 0.5.13 | 侧边栏文件活动页签：记录文件读取/新增/修改与统计，文件夹树形展示，点击浮窗预览                |
| [dsh-think-zh-expand](plugins/dsh-think-zh-expand/README.md)                       | 0.4.14 | 思考增强：强制中文思考与回复，思考块默认展开且支持 Markdown/表格/Mermaid 渲染                 |
| [dsh-mermaid-render](plugins/dsh-mermaid-render/README.md)                         | 0.1.11  | 对话 mermaid 代码块渲染为图表卡片，引擎随包分发、不依赖 CDN                                   |
| [dsh-md-render](plugins/dsh-md-render/README.md)                                   | 0.2.0  | 非思考模式 markdown 表格渲染增强：识别不标准表格，宽表格横向滚动                              |
| [dsh-my-notify](plugins/dsh-my-notify/README.md)                                   | 0.4.0  | 通知提醒：会话结束 / ask / 审批时浏览器通知 + 提示音，点击跳转；远程 hook 触发 + 出站 webhook |
| [dsh-my-remote](plugins/dsh-my-remote/README.md)                                   | 0.1.4  | 远程控制：ask / approval / 会话结束事件下行到手机或 IM，可远程回答、批准、查询、继续          |
| [dsh-my-guardian](plugins/dsh-my-guardian/README.md)                               | 0.4.3  | 插件治理：新装插件先进候选区逐个热挂载，失败自动隔离，一键安全模式 + 诊断面板                 |
| [dsh-task-reliability](plugins/dsh-task-reliability/README.md)                     | 0.4.9  | 任务可靠性：超时重试、未完成自动继续、完成度校验 agent、思考重复干预、重启恢复、自主决策      |
| [dsh-my-skill-manager](plugins/dsh-my-skill-manager/README.md)                     | 0.1.9  | Skill 管理：分全局/项目查看 skill，按项目启用/禁用（禁用即不注入会话）                        |
| [dsh-my-memory](plugins/dsh-my-memory/README.md)                                   | 0.1.9  | 记忆：全局/项目两级持久化，会话开始注入系统提示词；设置页面板 + 写操作确认                    |
| [dsh-my-plugin-manager](plugins/dsh-my-plugin-manager/README.md)                   | 0.1.6  | 插件管理面板：市场浏览/搜索、一键安装卸载、更新检查、已安装清单                               |
| [dsh-my-observability](plugins/dsh-my-observability/README.md)                     | 0.3.4  | 可观测性：事件审计、轨迹回放时间轴、结构化 Git 类型化提交、提交前增量 diff 审查               |
| [dsh-my-guard](plugins/dsh-my-guard/README.md)                                     | 0.1.8  | 安全护栏：破坏性命令执行前拦截、安装前投毒扫描、提示注入检测 + 告警面板                       |
| [dsh-my-context](plugins/dsh-my-context/README.md)                                 | 0.1.5  | 上下文透镜：token 用量与上下文构成可视化、KV 缓存命中率、每轮/每会话预算控制                  |
| [dsh-session-title-gen](plugins/dsh-session-title-gen/README.md)                   | 0.1.1  | 会话标题自动生成：LLM 生成结构化标题（先工作区后描述）并写入，重启保留                        |
| [dsh-my-opencode-session-header](plugins/dsh-my-opencode-session-header/README.md) | 0.1.0  | OpenCode 会话头：为 opencode 路由注入按会话稳定的 `x-opencode-session` 头                     |
| [dsh-plugin-dev-mode](plugins/dsh-plugin-dev-mode/README.md)                       | 0.1.1  | 插件开发模式 agent preset：启用 Cordis 工具集（动态插件生命周期），附随包技能                 |
| [dsh-ts-example](plugins/dsh-ts-example/README.md)                                 | 0.1.1  | TypeScript 插件开发示例：server 端 tsc 编译 + client 端构建期编译 + CI 类型检查               |
| [dsh-shared](plugins/dsh-shared/README.md)                                         | 0.1.6  | 共享工具包：多插件共用的 server 端工具（信任围栏 / HTTP JSON / 配置持久化 / 原子写）          |

## 🚀 快速开始

### 安装插件

```bash
dsh plugin --profile web add dsh-file-activity --trust-lockfile    # 单个
dsh plugin --profile web add dsh-shared dsh-md-render              # 多个
```

安装方式（npm / link / 手动）与各插件配置见 `plugins/<包名>/README.md`「安装」章节。

### 本地开发

```bash
git clone https://github.com/baosfeng/my-dsh-plugins.git && cd my-dsh-plugins
npm install
npm test          # 全量测试（CI 等价：npm run verify）
```

## 开发新插件

- [skills/dsh-plugin-development/SKILL.md](skills/dsh-plugin-development/SKILL.md) — 插件形态、目录结构、开发/调试/发布。
- [skills/dsh-github-triage/SKILL.md](skills/dsh-github-triage/SKILL.md) — 把需求整理成规范 issue 提交到本仓库。
- 开发流程与门禁见 [docs/索引.md](docs/索引.md)；文档写法见 [docs/开发指南/文档规范.md](docs/开发指南/文档规范.md)。

## 发布约定

- **双通道**：GitHub Release（tag 触发打包）+ npm 官方 registry（[release.yml](.github/workflows/release.yml) 读 `NPM_TOKEN` 自动发布，未配置仅警告跳过）。
- **发版入口**：Actions → **Release (auto)** workflow，或 `node scripts/release.mjs <插件名> --bump patch --push`。
- tag 格式 `<包名>@v<版本>`；每个插件独立 semver 与 CHANGELOG。

## 🤝 贡献指南

问题与需求走 [issue 模板](https://github.com/baosfeng/my-dsh-plugins/issues/new/choose)；提交流程、开发规范与审查要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

每个插件各自携带 MIT LICENSE；仓库级文档默认 MIT。
