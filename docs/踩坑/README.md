---
title: 踩坑记录
description: 项目已知问题与解决方案总索引
created: 2026-08-22
updated: 2026-09-12
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
- [协作 / 并行开发](多agent并行测试资源冲突.md) — 两个进程同时跑同一插件 Vitest 时 coverage 目录被另一进程占用、`npm test` 退出 1，易被误判为真实回归；全量遍历须避开并发开发窗口（2026-09-10）
- [宿主配置 / llm-pi-ai 路由](pi-ai路由模型未收录报needs-an-api.md) — 网关新模型不在 pi-ai catalog 内 + 路由为混合协议 → 模型条目报 `needs an api`；解法是 route 级显式声明 api 并抄同族 compat（同官方讨论 #4856，2026-09-10）
- [Skill / 写操作防护](非交互默认放行导致真实触发.md) — CLI 写命令在非 TTY 下把"非交互"当成"已同意"，重定向调用即真实触发流水线；改为 fail-closed 前置闸门（零请求拒绝）+ 20 项防回归自测（2026-09-11）
- [测试 / 环境相关断言](CI容器以root运行导致权限位断言失效.md) — 用 chmod 0555 注入写失败在 root/CAP_DAC_OVERRIDE 下无效导致假失败；2026-09-11 补记另一形态漏网（假定"`/` 根目录不可写"），改用 ENOTDIR/EISDIR 确定性注入（2026-09-10，2026-09-11 补记）
- [测试 / 时序竞态](固定sleep等异步落盘导致CI-flaky.md) — 用固定 sleep 等异步加载/落盘，CI 容器高负载下等待不足 → 随机红（本地连跑全绿不复现）；修法是实现给确定性就绪信号（whenReady）+ 测试改条件轮询 waitFor、查询路径等就绪，并把"未就绪就落盘"改成"等合并完成再落盘"，而不是把 sleep 调大（2026-09-11；2026-09-12 复发实例二：guardian 第三条启动链 runStartupCheck 不在 bootPromise/teardown 之内，见 issue #217）
- [CI / 门禁工具](jscpd原生二进制对glibc基线敏感.md) — jscpd 5.x 的 Rust 二进制要求 GLIBC ≥2.33，旧 glibc 容器加载失败 → 门禁项恒红且日志里没有任何重复清单（易误判成代码重复超标）；锁 4.x 纯 JS 版（2026-09-11）
- [工具 / 全仓扫描](超长单行让全仓正则扫描挂死.md) — 对全仓每一行跑链接正则时撞上 `vendor/mermaid.min.js` 单行 8.9MB → O(n²) 回溯、脚本挂死 180s 无输出；防压缩产物必须同时按"单行长度"设限（2026-09-11）
- [门禁 / 环境差异](本地绿不等于CI绿.md) — 同一校验脚本本地 exit 0、CI 首跑即红：macOS 不区分大小写，掩盖了 PR 模板真实文件名全大写、文档里却写成小写的差异；校验类工具的判定必须与宿主 FS 语义解耦（2026-09-11）
- [协作 / 子 agent 工作区](子agent工作区缺失导致卡死.md) — 新会话/隔离实例没有工作区时合成器被禁用，点「选择工作区」命中宿主原生 macOS 目录对话框（`osascript choose folder`），浏览器自动化无法驱动原生弹窗 → agent 静默卡死数天；修法是让用户事先选好工作区，或预置工作区落盘状态 / `--patch` 换 browse 后端（2026-09-12）
- [协作 / fork 池](fork池基线与squash判定.md) — `git clone --local` 的 `origin/main` 取的是主工作区本地 main（可能落后 GitHub）→ 基于过期基线开发；`git cherry` 靠 patch-id 判定，对 squash 合并必然假阴性 → 误判「遗留工作未落地」；判法是查 main 的 squash 提交/PR 号 + 比对整体 diff 的 `git patch-id --stable`（2026-09-12）
- [依赖安全 / audit 盲区](npm-audit在镜像源下静默失效.md) — npmmirror 无 advisories 端点 + `--registry` 被 `replace-registry-host` 重写回镜像 + CI 只阻断 high + Dependabot 告警是 `auto_dismissed`，四层叠加让 2 条 moderate 漏洞长期无人发现；修法是钉官方 registry、门槛提为 moderate、并校验「audit 真查过」而非只看退出码（已解决，2026-09-12，issue #199）
- [验证 / 隔离实例软链](隔离实例复用主工作区插件软链导致假验证.md) — 隔离 profile 把生产 `node_modules` 的 `link:` 软链整体复用，`--addons` 指定的待验代码被主工作区版本顶替（假通过/假失败）；修法是显式优先 + 启动前 `realpath` 校验 + 防回归测试（已解决，2026-09-12，issue #220）

## 维护规则

- 记录门槛：编译错误、API 不兼容、持续失败测试、执行过程踩坑
- 每条记录：标题（≤ 30 字）+ 状态 + 解决参考
- 已解决 & 超过 30 天未复现 → 移入 `归档/`

→ [索引.md](../索引.md)
