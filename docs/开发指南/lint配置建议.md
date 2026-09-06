---
title: lint配置建议
description: 本仓库 lint/格式/提交拦截工具配置现状 — ESLint 9+ flat config、Prettier、Knip、jscpd、Husky/commitlint，尺寸门禁（复杂度/行数）
created: 2026-08-22
updated: 2026-09-07
---

# Lint 与格式工具配置现状

> 记录本仓库 lint / 格式 / 提交拦截工具的**已落地配置**与关键规则说明。CI（quality job）强制执行，本地 `npm run lint` 复现。

## 当前状态

| 维度            | 配置                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 项目类型        | library（DSH 插件集合仓库）                                                                                                                    |
| 语言            | JavaScript（Node.js ≥ 20，ESM）                                                                                                                |
| Lint            | **ESLint 9+ Flat Config**（根 `eslint.config.js`）                                                                                             |
| 格式化          | **Prettier**（根 `.prettierrc.json`，issue #44：singleQuote / 无分号 / printWidth 120；行数为格式因变量，尺寸阈值已相应调整）                  |
| 死代码/重复代码 | **Knip**（根 `knip.json`，issue #45）、**jscpd**（根 `.jscpd.json`，issue #45，min-tokens 100，阈值 5%）                                       |
| 提交拦截        | Husky + lint-staged（pre-commit：eslint --fix + prettier --write）、commitlint（commit-msg，Conventional Commits）、.editorconfig（issue #44） |
| 已启用规则      | 圈复杂度 ≤ 10、单文件 ≤ 400 行、单函数 ≤ 70 行、`import/no-unresolved`（issue #48）、server 端 `no-undef`（recommended 自带）                  |

> lint 配置统一在仓库根 `eslint.config.js`（flat config）；CI `.github/workflows/ci.yml` quality job 执行 `npx eslint plugins/` 强制门禁（尺寸规则已启用，无 `--rule` 覆盖）。各插件目录（`plugins/<name>/`）各自带 `package.json`，但 lint 配置不分散。

## ESLint 配置结构（flat config，按文件类型分块）

| 配置块    | 匹配文件                                                                                     | 关键规则                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| server 端 | `plugins/**/lib/*.js`（排除 client 产物/模板）                                               | `js.configs.recommended` + 复杂度 ≤10 / 行数 ≤400 / 函数 ≤70 + `import/no-unresolved` + `no-undef`（recommended 自带） |
| client 端 | `plugins/**/lib/client.src.js` + `plugins/**/lib/parts/*.js`                                 | 同上尺寸规则 + `import/no-unresolved`；`no-undef`/`no-unused-vars` 关闭（`__ModuleLoader__` 格式）                     |
| 测试文件  | `plugins/**/test/**/*.mjs`                                                                   | `js.configs.recommended` + `import/no-unresolved`；`no-unused-vars` 豁免下划线参数                                     |
| ignores   | 构建产物 `lib/client.js`、`coverage/`、`.stryker-tmp/`、`reports/`、`dist/`、`node_modules/` | —                                                                                                                      |

## import/no-unresolved（issue #48）

检查 `import` / `require` 的模块真实存在，直接拦截「require 拼错模块名」类低级错误（如 #39 的 `require('dsh-md-render')` 拼写错误）。配置要点：

- 依赖 `eslint-plugin-import`（根 devDependency，`^2.32.0`）；其 peer 声明为 eslint ≤9，安装需 `--legacy-peer-deps`（实测 eslint 10 下规则正常工作）。
- 规则选项 `{ commonjs: true }`：**必须显式开启**，否则 `require()` 调用默认不被检查。
- resolver 设置 `import/resolver.node.moduleDirectory: ['node_modules', 'plugins']`：client 端 `require('dsh-md-render')` 等跨插件模块映射到仓库内 `plugins/<name>/` 真实检查。
- client 端额外 `ignore: ['^react$', '^react-dom(/.*)?$']`：react / react-dom 由 DSH 运行时注入浏览器（node_modules 无对应包），豁免；**其余 require 全部真实检查**。

**回归测试**：`scripts/test/lint-rules.test.mjs`（`npm run test:scripts` 自动包含）用 ESLint Node API 断言规则行为（server 端 require/import 不存在模块报错、client 端 dsh-* 解析与 react 豁免、no-undef 生效）。

## 插件源码特殊性（client 端）

`lib/client.js` 是浏览器模块加载器格式（`window.__ModuleLoader__.load`），非标准 Node ESM；产物由 `client.src.js` 模板 + `parts/*.part.js` 片段经 `scripts/build.mjs` 拼接生成。lint 时：

- 构建产物 `lib/client.js` 在 ignores 排除（mermaid 产物内嵌 8.9MB base64，ESLint 正则规则会崩溃）；
- `client.src.js` / `parts/*.js` 单独配置 `sourceType: 'script'` + 浏览器 globals，关闭 `no-undef`/`no-unused-vars`（片段注入 factory 作用域后互相引用），尺寸规则照常强制。

## 相关文档

→ [索引.md](../索引.md) · [构建与测试](构建与测试.md)（verify-local 覆盖项）
