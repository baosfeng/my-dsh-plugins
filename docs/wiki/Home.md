# Welcome to my-dsh-plugins Wiki

> 个人 DSH（DeepSeek Harness）插件集合仓库

## 📦 项目概述

本仓库包含 19 个插件（plugins/）+ 13 个 skill（skills/）+ 完整文档（docs/）。

技术栈：Node.js + Cordis 4 + React 18/19

## 🚀 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/baosfeng/my-dsh-plugins.git
cd my-dsh-plugins

# 安装依赖
npm install

# 启动 DSH
dsh web
```

### 使用插件

```bash
# 安装单个插件
dsh plugin install dsh-file-activity

# 或者使用本地开发模式
npm link
```

## 📚 文档导航

- [使用指南](Usage-Guide) - 详细使用说明
- [贡献指南](Contributing) - 如何参与贡献
- [开发指南](Development-Guide) - 插件开发入门
- [API 文档](API-Docs) - API 参考文档
- [插件列表](Plugin-List) - 所有插件说明

## 🔧 插件列表

| 插件名称                       | 功能描述         | 版本  | 状态    |
| ------------------------------ | ---------------- | ----- | ------- |
| dsh-file-activity              | 文件活动监控     | 0.5.8 | ✅ 稳定 |
| dsh-md-render                  | Markdown 渲染    | 0.1.8 | ✅ 稳定 |
| dsh-mermaid-render             | Mermaid 图表渲染 | 0.1.7 | ✅ 稳定 |
| dsh-my-context                 | 上下文管理       | 0.1.4 | ✅ 稳定 |
| dsh-my-guard                   | 守护进程         | 0.1.5 | ✅ 稳定 |
| dsh-my-guardian                | 插件守护         | 0.4.1 | ✅ 稳定 |
| dsh-my-memory                  | 记忆管理         | 0.1.7 | ✅ 稳定 |
| dsh-my-notify                  | 通知系统         | 0.3.9 | ✅ 稳定 |
| dsh-my-observability           | 可观测性         | 0.3.1 | ✅ 稳定 |
| dsh-my-opencode-session-header | 会话头部         | 0.1.0 | ✅ 稳定 |
| dsh-my-plugin-manager          | 插件管理         | 0.1.5 | ✅ 稳定 |
| dsh-my-remote                  | 远程连接         | 0.1.2 | ✅ 稳定 |
| dsh-my-skill-manager           | 技能管理         | 0.1.7 | ✅ 稳定 |
| dsh-plugin-dev-mode            | 开发模式         | 0.1.0 | ✅ 稳定 |
| dsh-session-title-gen          | 会话标题生成     | 0.1.0 | ✅ 稳定 |
| dsh-shared                     | 共享工具包       | 0.1.4 | ✅ 稳定 |
| dsh-task-reliability           | 任务可靠性       | 0.4.7 | ✅ 稳定 |
| dsh-think-zh-expand            | 中文思考扩展     | 0.4.8 | ✅ 稳定 |
| dsh-ts-example                 | TypeScript 示例  | 0.1.0 | ✅ 稳定 |

## 📞 联系方式

- **GitHub Issues**：[提交问题](https://github.com/baosfeng/my-dsh-plugins/issues)
- **Pull Requests**：[贡献代码](https://github.com/baosfeng/my-dsh-plugins/pulls)
- **Discussions**：[社区讨论](https://github.com/baosfeng/my-dsh-plugins/discussions)

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE)。

---

_最后更新: 2025-09-13_
