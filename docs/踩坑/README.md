---
title: 踩坑记录
description: 项目已知问题与解决方案总索引
created: 2026-08-22
updated: 2026-08-26
---

# 踩坑记录

> 本目录记录项目踩坑与解决方案，按功能域分组。新增踩坑时在对应功能域下创建条目文件。

## 功能域

- [发布 / Release](github-release版本校验失败.md) — release workflow 版本校验格式不一致导致任何 tag 发布失败（已解决，2026-08-23）
- [发布 / npm 补发与 latest 覆盖](npm发布补发与latest覆盖.md) — tag 已存在时重推不触发 npm 发布；发布顺序颠倒导致 dist-tags.latest 指向旧版（2026-09-01）
- [发布 / release.mjs dry-run bump](release脚本dry-run误写版本.md) — dry-run 已写入新版本号，--push 再次 bump 跳版本导致验证清单不匹配（2026-09-01）
- [发布 / 跨插件依赖](跨插件依赖未声明导致client崩溃.md) — client 端 require('dsh-*') 未声明 peerDependencies 导致插件加载崩溃（已解决，2026-08-28，issue #39）
- [插件集成 / 依赖级联安装](DSH插件依赖级联安装机制.md) — dependencies 中声明 dsh.bundle 的包会被 dsh plugin add 自动加入 profile bundles（2026-09-01）
- [客户端 UI / 样式](插件页签样式丢失.md) — 插件页签偶发"纯文字无样式"：样式注入放在服务判空早退之后，HMR 瞬间跳过注入（已解决，2026-08-23，v0.4.2）
- [插件集成 / llm 流](llm流async处理器误用.md) — `llm/stream` handler 误用 async function 导致 waterfall 返回 Promise，vision-toolkit `yield*` 委托流崩溃（已解决，2026-08-26，dsh-task-reliability）
- [客户端 UI / React 版本](DSH运行时React版本决定实际渲染.md) — 浏览器端实际渲染的 React 版本由 DSH 运行时（dsh-web-frontend 打包的 seed word）决定，与插件自身 node_modules 无关；peer 声明需与运行时匹配（issue #49，2026-08-28）
- [插件资源 / 写放大](插件资源占用事故复盘.md) — 事件流型持久化误用全量快照原语导致 #126 高 CPU/内存/300GB 磁盘写入事故；DSH 官方 session_projcache.json 全量重写同模式；防护：增量 append + 自监测降级 + CI 资源冒烟（issue #127，2026-09-04）

## 维护规则

- 记录门槛：编译错误、API 不兼容、持续失败测试、执行过程踩坑
- 每条记录：标题（≤ 30 字）+ 状态 + 解决参考
- 已解决 & 超过 30 天未复现 → 移入 `归档/`

→ [索引.md](../索引.md)
