---
title: 踩坑记录
description: 症状 → 解法速查表：按报错关键词一行一条，教训已固化在代码里的只留指针
---

# 踩坑记录

> 先在本文件按报错关键词搜（英文报错原文照抄，便于 grep）。教训已由代码/门禁承担的不再留长文，只给固化位置；标「详见」的分组另有分篇。

## 发布与版本

> 详见 [发版坑.md](发版坑.md)、[跨插件依赖与降级.md](跨插件依赖与降级.md)

- `tag 与 package.json 版本不一致`、Release workflow 卡在校验 → expected 去掉 `v` 前缀；bump 后先提交再打 tag。
- `dry-run 也写版本号`、版本连跳两级致验证清单与 CHANGELOG 对不上 → 发版一次跑完 `--bump patch --push`；误 bump 用 git checkout 恢复。固化在 `scripts/release.mjs`
- push 被 pre-push 拦下报 `根 README.md 插件表缺少 <插件> 行（或版本不是 x.y.z）`、发版输出只有 `README.md: no row` → prettier 按列宽给短版本补空格（表里存在 `0.5.10` 时 `0.1.5` 写成 `| 0.1.5  |`），同步正则必须与 `check-docs.mjs` 同口径容忍空白。固化在 `scripts/lib/release-checks.mjs` 的 `readmeVersionRowRe`（防复发单测在 `scripts/test/release-checks.test.mjs`）
- 一次 `git push` 推了十几个 tag，**GitHub Actions 一个 run 都不触发**（远端 tag 齐全、Release/npm 全无动静）→ 批量推 tag 时事件不派发（实测 14 个 tag 零触发）；对每个 tag 逐个「删远端 tag → 稍等几秒 → 重推」才会触发（间隔太短也会被节流，实测 ≥5s 有效）。发布后必须核对 `git ls-remote --tags` 与 Actions run 两侧，不能只看 tag 推上去了
- 并发发版残留孤儿实例、`EADDRINUSE`、实例互相踢 → 门禁 await 完再退出（失败路径也不提前 kill），端口由调度层预分配。固化在 `scripts/lib/release-checks.mjs`
- 改了 origin 的 url 却仍推 GitHub → `pushurl` 优先于 `url`，两个都要改；推前用 `git remote get-url --push origin` 自检
- `dsh plugin add` 后缺依赖、缺 client 注入项 → 插件型依赖写 `dependencies`（peer 永不安装）；详见 [跨插件依赖与降级.md](跨插件依赖与降级.md)
- `Element type is invalid … but got: null`（新装用户整条 UI 挂掉）→ 缺跨插件 client 依赖且未真降级；门禁见 `scripts/lib/release-checks.mjs`、`scripts/test/release-checks.test.mjs`

## CI 与门禁

> 详见 [CI门禁与巡检假阴性.md](CI门禁与巡检假阴性.md)、[异步落盘与时序.md](异步落盘与时序.md)

- 本地 pre-push 门禁「假红」：同一个插件 `npm test` 在 verify / release.mjs 里失败、单独跑却全绿，`release checks` 报 `单步超时 120.0s` → 先 `uptime` 看负载再判缺陷（实测批量发版把这台机 load 5 分钟均值压到 35+，依赖真实时钟的用例——如 webhook 重试链 1s+2s+4s——墙钟随之膨胀）；用 `VERIFY_CONCURRENCY=1` + 放宽 `VERIFY_STEP_TIMEOUT` / `VERIFY_TIMEOUT` 串行复跑，仍红才按真实失败处理
- Dependabot 面板 `0 条 open`、`ghops actions logs` 少一个失败 job → 只列 open 与归档残缺都不等于「不存在」，要显式查 closed 告警与 jobs 清单
- 本地门禁全绿、CI 首跑就红（报某引用路径不存在）→ 大小写不敏感的文件系统掩盖了真实文件名差异，判定必须枚举真实目录项
- `GLIBC_2.33 not found`（jscpd 门禁恒红且没有任何 clone 清单）→ 先判「工具没跑起来」而不是重复超标；glibc < 2.34 回退纯 JS 的 4.x
- `chmod 0555` 后仍写入成功、降级用例捕获到的 warn 为 0 → root 无视权限位，改注入 `EISDIR`／`ENOTDIR`；例见 `plugins/dsh-my-plugin-manager/test/host-api.mjs`
- `npm audit` 报 0 漏洞而实际有 moderate → 镜像源没有 advisories 端点；固化在 `scripts/lib/npm-audit.mjs`、`scripts/test/npm-audit.test.mjs`
- 为消 `js/file-system-race` 删掉 stat 导致类型闸门与字节账退化 → 改 `open` + fd `stat` + fd 读；固化在 `scripts/check-links.mjs`、`scripts/test/check-links-limits.test.mjs`
- CI 随机红一条（只读到 1 条而非 2 条）、本地连跑全绿 → 固定 sleep 等异步落盘；详见 [异步落盘与时序.md](异步落盘与时序.md)（新增固定 sleep 须写 `// sleep-ok: 理由`，门禁 `scripts/check-test-sleeps.mjs`）
- 同插件两个测试进程撞 `coverage` 目录、失败者没有 `Tests` 行 → 并行按插件划分；固化在 `scripts/test-all.sh`

## 插件运行时与宿主 API

> 详见 [宿主运行时陷阱.md](宿主运行时陷阱.md)、[插件资源占用.md](插件资源占用.md)

- 插件已加载但事件 0 触发、路由 404、日志无报错 → 监听器注册随插件 fiber 被回收，要挂到常驻 root
- 页签偶发变纯文字、图标与徽标消失、刷新页面即恢复 → 样式注入排在了服务判空早退之后
- `yield* (intermediate value) is not async iterable` → `llm/stream` 的 handler 写成 async，把流包成了 Promise
- 监听器 `return` 了值、发送方只拿到 `undefined`（聚合端点给每个插件编造"运行中"）→ `emit` 不收集返回值、`parallel` 不返回结果，收集返回值只能用 `serial`；详见 [宿主运行时陷阱.md](宿主运行时陷阱.md)
- 长会话 CPU 数百 %、内存 GB 级、磁盘每小时 GB 级写入 → 事件流误用全量快照原语；详见 [插件资源占用.md](插件资源占用.md)
- 状态文件停在旧内容且不报错，只有 `write blocked … dropping pending snapshot` → 调度器与快照原语双节流互斥；详见 [异步落盘与时序.md](异步落盘与时序.md)

## 验证环境

> 详见 [隔离实例验证.md](隔离实例验证.md)

- 部分插件 client bundle 不进 manifest、server API 404 而日志无报错 → 复刻 profile 时带上了插件管理器的禁用名单
- 验证全绿但实例加载的是主工作区版本（或反过来假失败）→ `--addons` 待验路径被已存在的软链顶替
- 点「选择工作区」后 DOM 无菜单、进程挂着 `osascript` 原生目录对话框 → 无工作区时改用参数预置工作区
- `--checklist` 重跑后人工验证记录被删、头部时间被改成假 diff → 生成器整文件重写；固化在 `scripts/lib/verify-checklist.mjs`、`scripts/test/verify-checklist.test.mjs`

## 工具链与脚本

> 详见 [fork池工作流.md](fork池工作流.md)

- fork 基线落后远端 main、`git cherry` 把已 squash 合并的工作全标未应用 → clone 不复制 remote-tracking refs，判定落地要用 patch-id
- fork 里 `git commit` 秒过、无 lint-staged 输出，直到 CI 才红 → 钩子挂载信息没随 clone 复制过去
- 全仓文本扫描脚本无任何输出挂死、被超时杀掉 → 压缩产物的超长单行让正则回溯退化；固化在 `scripts/check-links.mjs`
- 非 TTY 下写命令只打一行警告就真实执行（曾误触发远端流水线）→ fail-closed 闸门：非 dry-run／`--yes`／TTY 直接退出
