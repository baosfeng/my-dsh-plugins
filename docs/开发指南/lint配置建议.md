---
title: lint 配置建议
description: 本仓库 lint 门禁现状 — ESLint flat config 分块、import 解析、TS 源码尺寸门禁与冻结债务基线
---

# Lint 配置建议

> ⚠️ **何时阅读：** 改 `eslint.config.js` / lint 规则、怀疑某处尺寸门禁没生效、或新增共享/生成代码需要豁免时。

## 门禁现状

| 维度     | 现状                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 工具链   | ESLint 10 Flat Config（根 `eslint.config.js`）+ Prettier（`.prettierrc.json`）+ Knip（`knip.json`）+ jscpd（`.jscpd.json`） |
| 尺寸门禁 | 圈复杂度 ≤10、单文件 ≤400 行、单函数 ≤70 行——手写 JS 由 ESLint 强制，TS 源码由 `scripts/check-ts-size.mjs` 强制             |
| 其它规则 | `import/no-unresolved`（server + client）、server 端 `no-undef`；knip 死代码、jscpd 重复代码（min-tokens 100，阈值 5%）     |
| 提交拦截 | Husky + lint-staged（pre-commit：eslint --fix + prettier --write）、commitlint（commit-msg，Conventional Commits）          |
| CI       | `.github/workflows/ci.yml` 的 quality job 跑 `npx eslint plugins/` 与 `npm run lint:size`                                   |

```bash
npm run lint          # eslint plugins/（质量规则 + 尺寸门禁，覆盖手写 JS）
npm run lint:size     # TS 源码尺寸门禁（check-ts-size + 冻结债务基线）
```

## ESLint 分块（flat config，按文件类型）

| 配置块    | 匹配文件                                                                                               | 关键规则                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| server 端 | `plugins/**/lib/*.js`（排除 client 产物/模板）                                                         | `js.configs.recommended` + 三项尺寸规则 + `import/no-unresolved` + `no-undef`                                    |
| client 端 | `plugins/**/lib/client.src.js`、`plugins/**/lib/parts/*.js`                                            | 尺寸规则 + `import/no-unresolved`；`no-undef`/`no-unused-vars` 关闭（`__ModuleLoader__` 拼接格式，片段互相引用） |
| 测试文件  | `plugins/**/test/**/*.mjs`                                                                             | `recommended` + `import/no-unresolved`；`no-unused-vars` 豁免下划线参数                                          |
| TS 源码   | `plugins/*/src/**/*.ts`                                                                                | **不在 ESLint 范围内** → 由 `check-ts-size.mjs` 施加同样三项尺寸门禁                                             |
| ignores   | `lib/client.js`（产物）、`vendor/`、`coverage/`、`.stryker-tmp/`、`reports/`、`dist/`、`node_modules/` | —                                                                                                                |

产物 `lib/client.js` 必须排除：mermaid 产物内嵌 8.9MB base64，ESLint 正则规则会崩溃。

## `import/no-unresolved` 配置要点

- 依赖 `eslint-plugin-import`（peer 声明为 eslint ≤9，安装需 `--legacy-peer-deps`，eslint 10 下规则实测正常）。
- **`{ commonjs: true }` 必须显式开启**，否则 `require()` 调用默认不被检查。
- resolver 设 `import/resolver.node.moduleDirectory: ['node_modules', 'plugins']`：让 client 端 `require('dsh-md-render')` 这类跨插件模块映射到仓库内 `plugins/<name>/`（DSH 运行时按插件名提供模块）。
- client 端额外 `ignore: ['^react$', '^react-dom(/.*)?$']`（由 DSH 运行时注入浏览器，node_modules 无对应包）；**其余 require 全部真实检查**。
- 回归测试：`scripts/test/lint-rules.test.mjs`（`npm run test:scripts` 自动包含）。

## TS 源码尺寸门禁（`scripts/check-ts-size.mjs`）

flat config 无 `.ts` 块（typescript-eslint 尚不兼容 TS 7），若不单独施加，`src/**/*.ts` 会整体逃过尺寸门禁。脚本用 `@babel/parser` 解析 TS AST，按 ESLint 内置规则的**真实语义**重新施加：

| 规则                     | 阈值 | 语义（对齐 ESLint 内置规则）                                                   |
| ------------------------ | ---- | ------------------------------------------------------------------------------ |
| `max-lines`              | ≤400 | 含空行与注释；文件末尾换行产生的空行不计                                       |
| `max-lines-per-function` | ≤70  | `loc.end.line - loc.start.line + 1`；IIFE 不计、方法含 `static`/`async` 修饰符 |
| `complexity`             | ≤10  | 基础 1；每个分支/短路算子 +1；嵌套作用域独立算                                 |

复杂度算子：`if`（含 `else if`）、三元、`&&`/`||`/`??`、各类循环、`catch`、`case`（`default` 不计）、默认参数与解构默认值、逻辑赋值、可选链。嵌套函数、类字段初始化器、`static {}` 块各自独立 code path。

```bash
node scripts/check-ts-size.mjs                    # 门禁模式（CI 与 npm run lint:size 用）
node scripts/check-ts-size.mjs --json             # 机器可读结果
node scripts/check-ts-size.mjs --update-baseline  # 拆分收口后重新生成基线
```

- **冻结债务基线**（`scripts/ts-size-baseline.json`）：迁移引入的存量超标项写入基线，不超过记录值即通过（允许变好）；**基线之外的新增超标、或超过记录值的恶化一律失败**；已达标或消失的条目只提示"可移除"。
- **退出码**：0 通过 / 1 门禁失败 / 2 工具错误（TS 解析失败、基线缺失或损坏、用法错误）——**解析失败绝不静默跳过**。
- `--update-baseline` 之外不要手工编辑基线。
