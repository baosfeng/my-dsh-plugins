---
title: React 19 兼容性评估
description: issue #49 — React 18 → 19 升级的兼容性评估结论：DSH 运行时 React 版本调研、各插件 React 用法清单、兼容性判定、peer 声明决策
created: 2026-08-28
updated: 2026-09-07
---

# React 19 兼容性评估（issue #49）

> 本文档记录 issue #49「React 18 → 19 升级（评估兼容性 + 回归验证）」的评估结论与决策。
> 结论先行：**全部 13 个插件 client 端代码 100% 兼容 React 19，无需代码改动**；peer 声明升级为 `^18.2.0 || ^19.2.0`（双范围），理由见下文「peer 声明决策」。

## 1. 关键决策点：DSH 运行时 React 版本

**浏览器端实际渲染的 React 版本由 DSH 运行时决定，与插件自身 node_modules 无关。**

| 事实                                                                           | 证据                                                                                                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DSH Vite shell（dsh-web-frontend 0.1.1-rc.2）打包 react / react-dom **18.3.1** | dist 产物含 `18.3.1",rendererPackageName:"react`；`staticModules` 定义 `{react, "react/jsx-runtime", "react-dom", "react-dom/client", ...}` 作为平台 seed word |
| 插件 client bundle 的 `require('react')` 解析到平台 seed word（18.3.1）        | dsh-client-modules 的 require 分支顺序：seed word → 已物化模块 → 注册工厂                                                                                      |
| npm 上 @deepseek-ai/dsh 最新版（0.1.1-rc.2，latest=next 同版本）仍是 React 18  | `npm view @deepseek-ai/dsh dist-tags`                                                                                                                          |
| dsh-better-sidebar 0.16.1 peer 声明 react ^18.2.0 + react-dom ^18.2.0          | 已安装包 peerDependencies                                                                                                                                      |

**结论**：DSH 生态（运行时 + 宿主服务）当前全部基于 React 18.3.1，**没有 React 19 运行时可用**；DSH 侧升级由 @deepseek-ai 控制，本仓库无法先行升级。因此本 issue 的升级范围限定为：**插件代码兼容性评估 + peer 声明升级（声明对 React 19 的兼容性）**，实际渲染版本仍由 DSH 运行时（18.3.1）决定。

## 2. 各插件 React 用法清单（13 个有 client 的插件）

全部使用 `createElement` + `useState` / `useEffect` / `useMemo`（dsh-file-activity 额外用 `useSyncExternalStore`；dsh-think-zh-expand 仅 `createElement` + `useState`）；**无 forwardRef / Context / propTypes / string ref 等高级 API**。特殊项：

- **react-dom/client `createRoot` + `root.render`**：仅 dsh-mermaid-render（React 19 保留该 API，移除的是旧 `ReactDOM.render`）；
- **官方 `slots` 服务**：dsh-my-skill-manager / dsh-my-plugin-manager（`ctx.get('slots')` + `slots.inject('settings.plugins.tab', ...)`，组件由宿主渲染，与 React 版本无关）；
- **跨插件依赖**：dsh-think-zh-expand `require('dsh-md-render')`（peer 已声明），与 React 版本无关。

> dsh-plugin-dev-mode 为 agent preset（无 client 端），不在评估范围。

## 3. 兼容性判定

### 3.1 使用的 API 在 React 19 中的状态

| API                                             | React 18      | React 19                                    | 判定 |
| ----------------------------------------------- | ------------- | ------------------------------------------- | ---- |
| `createElement`                                 | ✅            | ✅（未移除，仍支持）                        | 兼容 |
| `useState` / `useEffect` / `useMemo`            | ✅            | ✅（行为一致）                              | 兼容 |
| `useSyncExternalStore`                          | ✅（18 引入） | ✅                                          | 兼容 |
| `react-dom/client` `createRoot` + `root.render` | ✅（18 引入） | ✅（保留；19 移除的是旧 `ReactDOM.render`） | 兼容 |

### 3.2 破坏性变化与新特性逐项检查

React 19 破坏性变化（移除 `ReactDOM.render` / propTypes / legacy context / string refs / UMD builds、`useEffect` 清理时序变化、ref 作为 prop、Context 直接 Provider）**均不影响本仓库**——各插件均未使用；React 19 新特性（Actions / `use()` / `<Activity>` / `useEffectEvent`）**均未使用**（dsh-file-activity 源码中的 "Activity" 仅为注释文案 "File Activity"）。

### 3.3 结论

**全部 13 个插件 client 端代码 100% 兼容 React 19，无需任何代码改动。** 若未来 DSH 运行时升级到 React 19，插件可直接运行。

## 4. peer 声明决策

### 4.1 选项对比

| 方案                                    | 与当前运行时（18.3.1）匹配 | npm 安装（ERESOLVE） | pnpm 安装（DSH 官方方式） | 未来 DSH 升级 19  |
| --------------------------------------- | -------------------------- | -------------------- | ------------------------- | ----------------- |
| A. 升级 `^19.2.0`                       | ❌ 不匹配                  | ❌ 报错阻断          | ⚠️ 警告                   | ✅ 匹配           |
| B. 保持 `^18.2.0`                       | ✅ 匹配                    | ✅                   | ✅                        | ❌ 不匹配（警告） |
| C. **`^18.2.0 \|\| ^19.2.0`（双范围）** | ✅ 匹配                    | ✅                   | ✅                        | ✅ 匹配           |

### 4.2 决策：采用方案 C（双范围声明）

理由：

1. **peer 声明应反映实际兼容范围**：插件代码在 React 18.2+ 与 19.2+ 下均可运行，`^18.2.0 || ^19.2.0` 是精确的声明。
2. **避免安装失败**：实测 npm 在 react 18.3.1 环境下安装 peer `^19.2.0` 的包会报 ERESOLVE 错误（阻断用户手动 npm 安装）；pnpm（DSH 官方安装方式）仅警告。双范围声明两种场景均无警告无失败。
3. **未来兼容**：DSH 运行时升级到 React 19 后，插件 peer 声明自动匹配，无需再次修改。
4. **npm 生态标准做法**：与 @tanstack/react-virtual 等库的 `^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0` 声明模式一致。

### 4.3 升级清单（13 个插件）

- 11 个已有 react peer 的插件（dsh-file-activity / dsh-md-render / dsh-mermaid-render / dsh-my-context / dsh-my-guard / dsh-my-guardian / dsh-my-memory / dsh-my-observability / dsh-my-plugin-manager / dsh-my-skill-manager / dsh-think-zh-expand）：`react: ^18.2.0` → `react: ^18.2.0 \|\| ^19.2.0`；
- dsh-my-notify / dsh-task-reliability：补 `react: ^18.2.0 \|\| ^19.2.0`（client 端 require('react') 但缺 peer 声明）；
- dsh-mermaid-render：补 `react-dom: ^18.2.0 \|\| ^19.2.0`（client 端 require('react-dom/client') 但缺 peer 声明）。

> dsh-plugin-dev-mode 无 client 端、无 react 依赖，不涉及。

## 5. 验证记录

- [x] 全量测试通过（`scripts/test-all.sh`：node --check + 各插件 npm test）
- [x] 真实环境验证无回归（独立端口 + 浏览器，各插件 client 端加载/渲染正常，见 issue #49 评论截图）
- [x] 技术栈版本文档同步

→ [索引.md](../索引.md)
