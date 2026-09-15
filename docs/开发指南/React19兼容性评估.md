---
title: React 19 兼容性评估
description: React 18 → 19 的兼容性结论与 peer 声明决策 — 插件代码 100% 兼容，采用双范围声明
---

# React 19 兼容性评估

> ⚠️ **何时阅读：** 想改插件 react / react-dom 的 peer 声明范围，或宿主 React 版本变化时。

## 结论

**全部有 client 端的插件代码 100% 兼容 React 19，无需任何代码改动**；若未来 DSH 运行时升到 React 19，插件可直接运行。因此 react 的 peer 声明采用**双范围 `^18.2.0 || ^19.2.0`**。

## 关键事实

**浏览器端实际渲染的 React 版本由 DSH 运行时决定，与插件自身 node_modules 无关。** 宿主 shell 把 react / react-dom 打进主 bundle 并以 `staticModules`（平台 seed word）暴露，插件 client bundle 的 `require('react')` 命中的是它。当前 DSH 生态（运行时 + 宿主服务）全部基于 React 18，升级由 @deepseek-ai 控制，本仓库无法先行。

兼容性依据：插件 client 只用到 `createElement`、`useState` / `useEffect` / `useMemo`、`useSyncExternalStore`、`react-dom/client` 的 `createRoot` + `root.render`——React 19 均保留（19 移除的是旧 `ReactDOM.render`）。未使用 `propTypes` / `defaultProps` / legacy context / string refs / `findDOMNode` / `forwardRef` / `Context` / UMD builds，也不依赖 `useEffect` cleanup 时序。slots 渲染、`__ModuleLoader__` 格式、跨插件 require 均由宿主机制承担，与 React 版本无关。

## peer 声明决策

| 方案                                  | 当前运行时匹配 | npm 安装         | pnpm 安装 | 未来宿主升 19 |
| ------------------------------------- | -------------- | ---------------- | --------- | ------------- |
| A. `^19.2.0`                          | ❌             | ❌ ERESOLVE 阻断 | ⚠️ 警告   | ✅            |
| B. `^18.2.0`                          | ✅             | ✅               | ✅        | ❌ 不匹配     |
| **C. `^18.2.0 \|\| ^19.2.0`（采纳）** | ✅             | ✅               | ✅        | ✅            |

理由：peer 声明应反映**实际兼容范围**（代码在 18.2+ 与 19.2+ 都能跑）；避免用户在 React 18 环境下 `npm install` 被 ERESOLVE 阻断；宿主升级后无需再改；与 npm 生态常见的多版本范围声明一致。

**改动清单**：11 个已有 react peer 的插件把 `^18.2.0` 改为双范围；client 端 `require('react')` 但缺声明的插件补 `react` peer；`dsh-mermaid-render` 另补 `react-dom` peer（它用 `react-dom/client`）。agent preset 形态插件无 client 端，不涉及。

**改动后验证**：全量测试通过（`node --check` + 各插件 `npm test`）+ 真实环境无回归（独立端口 + 浏览器，各插件 client 端加载/渲染正常）。

> 若哪天要放弃 React 18 用户，执行顺序见 [依赖升级矩阵](依赖升级矩阵.md)（须先与上游 sidebar 对齐，再整批发版）。

→ [索引.md](../索引.md)
