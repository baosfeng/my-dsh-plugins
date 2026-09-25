# dsh-ts-example

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="侧边栏「TS 示例」页签：显示当前会话问候语" src="./assets/screenshot.png" width="420" />
</div>

**DSH 插件 TypeScript 开发示例插件**：演示新插件用 TypeScript 开发的全流程——server 端 TS 源码 + `tsc` 编译，client 端 TS 源码 + 构建时编译；编译期即可发现模块不存在、类型不匹配、未定义变量等错误。

## 功能

- **问候语路由**：`GET /ts-example/api/greeting?name=xxx` → `{ "greeting": "Hello, xxx!" }`（支持 `zh` / `en` 语言配置）；
- **会话计数**：`GET /ts-example/api/stats` → `{ "sessions": N }`（监听宿主 `session/created` 事件计数）；
- **侧边栏页签「TS 示例」**：显示当前会话的问候语（client 端 TS → server 端 TS 全链路），经宿主原生侧边栏扩展点注册，零第三方依赖——同时作为「原生扩展点 + TS 构建」的活样例。

## 配置

| 配置项     | 类型           | 默认值 | 说明       |
| ---------- | -------------- | ------ | ---------- |
| `language` | `'zh' \| 'en'` | `'en'` | 问候语语言 |

## 安装

```bash
# npm 安装（该包尚未发布到 npm，发版后可用）
dsh plugin --profile web add dsh-ts-example --trust-lockfile

# 本地 link（当前可用方式）
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-ts-example
```

## 相关文档

→ [TS 示例概述](../../docs/TS示例/概述.md) · [CHANGELOG](CHANGELOG.md)
