---
title: TS 升级规范
description: 全量 TypeScript 迁移规范 — 目录结构、tsconfig、类型声明、产物同步与仓库级门禁
---

# TS 升级规范

> ⚠️ **何时阅读：** 把插件迁到 TypeScript、改 `src/**/*.ts` 或 tsconfig 前必读。

## 一、目录结构约定

- server 端：源码 `src/*.ts`（入口 `src/index.ts` 导出 `{ name, inject, apply }`）+ `src/types.d.ts`（DSH 运行时最小契约）；`tsc` 产物落 `lib/*.js`（**必须提交**）。
- client 端两种合法形态，按插件现有 `lib/client.js` 结构选一种即可：
  - **A：parts 拼接**（主流）——源码 `src/client/parts/*.ts`，入口由 `lib/client.src.js` 模板承担（**无** `src/client/index.ts`）。
  - **B：单文件**——源码 `src/client/index.ts` 编译成单文件 bundle，注入模板的 `/*__CLIENT_BUNDLE__*/` 占位符。
- 只有「占位契约」而无实现的 `src/client/index.ts`（注释自述"仅为让 typecheck 通过"、真实逻辑仍手写 parts）**不算迁移完成**。
- `src/client/globals.d.ts` 两种形态都需要（client 全局契约：DSH 运行时 / React hooks）。
- client 片段是纯函数声明文本，**无 import/export**；`lib/client.src.js` 是手写模板（不是产物），`lib/client.js` 与构建需要的 `lib/parts/` 是产物（`lib/parts/` 仅当本插件测试要读时才提交）。

## 二、tsconfig 关键项

| 项          | server（`tsconfig.json`）                                                                | client（`tsconfig.client.json`）                                             |
| ----------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 严格 / 目标 | `strict: true`、`target: es2022`                                                         | 同                                                                           |
| 模块        | `module` + `moduleResolution`: `nodenext`                                                | `module: commonjs`、`moduleResolution: bundler`                              |
| 目录        | `rootDir: src`、`outDir: lib`、`exclude: ["src/client"]`                                 | `rootDir: src/client`、`outDir: lib/.client-build`、`lib: ["es2022", "dom"]` |
| 其它        | `types: ["node"]`、`skipLibCheck`、`esModuleInterop`、`forceConsistentCasingInFileNames` | `types: []`，其余项相同                                                      |

- 仓库根 tsconfig 必须 **exclude `plugins/*/src/client/**`**：client 片段无 import/export，在 nodenext 下会被当成独立模块，导致跨文件符号全部解析失败；client 端检查由各插件 `tsconfig.client.json` 承担，不能漏。
- 相对 import 必须带 `.js` 扩展名（nodenext 要求，tsc 会自动映射到 `.ts`）。

## 三、package.json scripts

```json
{
  "scripts": {
    "build": "npx tsc -p tsconfig.json && node scripts/build.mjs",
    "typecheck": "npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.client.json",
    "test": "npx vitest run --coverage"
  }
}
```

仅有 server 端时 build 简化为 `"npx tsc -p tsconfig.json"`；typecheck 只检查有 TS 源码的配置。

## 四、类型声明

- `src/types.d.ts` 手写 DSH 运行时**最小契约**（`webServer` / `webRuntime` / `sessions` / `logger` / `on` / `effect`），**不安装 cordis 类型包**。
- client 端类型内联在入口或 `globals.d.ts`（按宿主服务的真实契约声明形状）。
- **禁止**写 `declare module 'dsh-shared'` 这类 ambient 声明：根配置加载所有 `.d.ts`，它会**全局覆盖**真实模块类型，让别的插件报「模块没有导出成员」。

## 五、仓库级门禁

| 门禁           | 命令                            | 常见失败原因与修法                                                                                                            |
| -------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 全仓类型检查   | `npx tsc --noEmit`              | 根 tsconfig 缺 `types: ["node"]` → `process`/`Buffer`/`node:*` 全报 TS2591 并连锁 TS7006/TS18046                              |
| 逐插件类型检查 | `bash scripts/typecheck-all.sh` | 插件漏配 `tsconfig.client.json`                                                                                               |
| 格式           | `npx prettier --check .`        | tsc 产物风格与 prettier 不同（产物已在 `.prettierignore` 排除），但 `src/**/*.ts` 必须 `prettier --write`                     |
| Lint           | `npx eslint plugins/`           | tsc 产物被当手写代码 → `max-lines` / `no-unused-vars` 误报（`eslint.config.js` 的 `tscArtifacts()` 动态排除已迁移插件的产物） |
| 死代码         | `npx knip`                      | `entry` / `project` 必须覆盖 `src/**` 与 `lib/index.js`，否则报几十个 Unused files                                            |
| 依赖结构       | `npx depcruise plugins/`        | 构建临时目录 `lib/.client-build/` 残留导致 ENOENT                                                                             |
| TS 源码尺寸    | `npm run lint:size`             | 阈值与修法见 [lint 配置建议](lint配置建议.md)                                                                                 |

## 六、常见问题

- **client 端为什么用 CommonJS 且必须单文件**：DSH 的 `__ModuleLoader__` 在浏览器端注入 `require`/`exports`/`module`，且**不支持相对路径 require**——所有代码必须在同一个 factory 作用域内。
- **产物必须提交吗**：是。CI 只跑 `node --check` + 测试，不跑构建。
