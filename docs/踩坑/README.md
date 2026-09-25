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
- 一次 `git push` 推了十几个 tag，**GitHub Actions 一个 run 都不触发**（远端 tag 齐全、Release/npm 全无动静）→ 一次 push 只应承载一个 ref，批量推 tag 时事件会被合并/丢弃；改成**逐个推**（`pushTagsIndividually`）+ 推后逐个确认触发（`confirmTagTriggered`），固化在 `scripts/lib/release-tag-push.mjs`。已推上去却没触发才用「删远端 tag → 稍等几秒 → 重推」补救（间隔太短也被节流，实测 ≥5s 有效）。发布后必须核对 `git ls-remote --tags` 与 Actions run 两侧
- `Error saving asset` / `Error creating asset temp dir` / `Error uploading` / action-gh-release 步骤吐 `<!DOCTYPE html>`（上传挂住数分钟）→ 两套 release workflow 同监听 `push: tags` 时**并发抢建同一个 Release**、互删同名 tgz；一个 tag 只留一套发布 workflow（`release-optimized.yml` 已删）+ 同 tag `concurrency` 串行。**判定看 Release/npm 交付物是否到位，不看单个 run 的红绿**。详见 [发版坑.md](发版坑.md)
- 并发发版残留孤儿实例、`EADDRINUSE`、实例互相踢 → 门禁 await 完再退出（失败路径也不提前 kill），端口由调度层预分配。固化在 `scripts/lib/release-checks.mjs`
- 发版脚本报 `npm <包>@<版本> 未在 5 分钟内发布` 而 npm 上其实已发布（或反之）→ 本机 npm 版本查询走镜像且缓存陈旧（实测本机某包显示旧版本、官方 registry 已是新版本），本地判定 npm 既慢又不准；已改为**发版后不再轮询 npm**（只等 GitHub Release）。核对以官方源为准：`npm view <包> version --registry=https://registry.npmjs.org`。固化在 `scripts/lib/post-release.mjs`、`scripts/test/post-release.test.mjs`
- 改了 origin 的 url 却仍推 GitHub → `pushurl` 优先于 `url`，两个都要改；推前用 `git remote get-url --push origin` 自检
- 推送卡在 `Connection timed out during banner exchange` / `ssh: connect to host github.com port 22: Operation timed out`，而 `gh-net check` 全绿 → 那检查的是 **HTTP 代理**通路，`push` 走的是 SSH：22 端口必须经代理，用 `GIT_SSH_COMMAND="ssh -o ProxyCommand='nc -X connect -x 127.0.0.1:7890 %h %p'" git push origin main`（先 `ssh -T git@github.com` 同法验证握手）。另：`ghops` 把代理探测结果缓存在 `~/.dsh/secrets/github-proxy-probe`，一次网络抖动被判 `ok:false` 后会**持续降级为直连**（表现为 `Operation too slow` <1000 B/s 或 `SSL_ERROR_SYSCALL`）——删掉该缓存文件即恢复探测；网络间歇时推送需带重试。另：`gh-net fix` 是**按自己的探测结果**重配的，而 `gh-net check` 的代理探测只给 6s 超时，瞬时抖动即误判「代理不可用」→ 把 git `http.proxy` 与 ghops 代理文件一并**清空**、全局退化为直连（`git ls-remote` 直接超时）。判定：先自测 `curl -s -o /dev/null -w '%{http_code}' --max-time 15 -x http://127.0.0.1:7890 https://api.github.com`，通了就别跑 `fix`；已被清空则按 `skills/dsh-github-triage/references/network-and-fork-pool.md`「网络前置」重设三层配置
- `git push https://…` 报 `could not read Username for 'https://github.com'` → 非交互环境没有凭据输入通道；HTTPS 推送须走 `ghops`（它用封装的凭据构造 askpass），不要试图直接 `git push https://`
- `dsh plugin add` 后缺依赖、缺 client 注入项 → 插件型依赖写 `dependencies`（peer 永不安装）；详见 [跨插件依赖与降级.md](跨插件依赖与降级.md)
- `Element type is invalid … but got: null`（新装用户整条 UI 挂掉）→ 缺跨插件 client 依赖且未真降级；门禁见 `scripts/lib/release-checks.mjs`、`scripts/test/release-checks.test.mjs`

## CI 与门禁

> 详见 [CI门禁与巡检假阴性.md](CI门禁与巡检假阴性.md)、[异步落盘与时序.md](异步落盘与时序.md)

- 本地 pre-push 门禁「假红」：同一个插件 `npm test` 在 verify / release.mjs 里失败、单独跑却全绿，`release checks` 报 `单步超时 120.0s` → 先 `uptime` 看负载再判缺陷（实测批量发版把这台机 load 5 分钟均值压到 35+，依赖真实时钟的用例——如 webhook 重试链 1s+2s+4s——墙钟随之膨胀）；用 `VERIFY_CONCURRENCY=1` + 放宽 `VERIFY_STEP_TIMEOUT` / `VERIFY_TIMEOUT` 串行复跑，仍红才按真实失败处理
- Dependabot 面板 `0 条 open`、`ghops actions logs` 少一个失败 job → 只列 open 与归档残缺都不等于「不存在」，要显式查 closed 告警与 jobs 清单
- 本地门禁全绿、CI 首跑就红（报某引用路径不存在）→ 大小写不敏感的文件系统掩盖了真实文件名差异，判定必须枚举真实目录项
- 隔离实例里插件「少了 / client 不进 manifest / 设置页签不出现 / API 404」而代码与产物都正常 → 生产 profile 的 `cordis.patch.yml` 写着 `- id: <插件>` + `disabled: true`（与 `.dsh-market/state.json` 是**两处独立禁用来源**，`verify-real-profile.mjs` 只剥离后者，于是被复刻进隔离实例）；验证前 `grep -B1 'disabled: true' <隔离 profile>/cordis.patch.yml`，把待验插件改成 `false` 后 `watchUserPatches` 热重载即生效（实测改后页签立即出现）
- `GLIBC_2.33 not found`（jscpd 门禁恒红且没有任何 clone 清单）→ 先判「工具没跑起来」而不是重复超标；glibc < 2.34 回退纯 JS 的 4.x
- `chmod 0555` 后仍写入成功、降级用例捕获到的 warn 为 0 → root 无视权限位，改注入 `EISDIR`／`ENOTDIR`；例见 `plugins/dsh-my-plugin-manager/test/host-api.mjs`
- `npm audit` 报 0 漏洞而实际有 moderate → 镜像源没有 advisories 端点；固化在 `scripts/lib/npm-audit.mjs`、`scripts/test/npm-audit.test.mjs`
- 为消 `js/file-system-race` 删掉 stat 导致类型闸门与字节账退化 → 改 `open` + fd `stat` + fd 读；固化在 `scripts/check-links.mjs`、`scripts/test/check-links-limits.test.mjs`
- CI 随机红一条（只读到 1 条而非 2 条）、本地连跑全绿 → 固定 sleep 等异步落盘；详见 [异步落盘与时序.md](异步落盘与时序.md)（新增固定 sleep 须写 `// sleep-ok: 理由`，门禁 `scripts/check-test-sleeps.mjs`）
- 同插件两个测试进程撞 `coverage` 目录、失败者没有 `Tests` 行 → 并行按插件划分；固化在 `scripts/test-all.sh`
- 本机 `~/.dsh` 配置莫名变成**测试夹具**、插件禁用状态丢失、用户配置回默认 → 测试里 `writeFileSync(patchFileOf(...))` 是**整文件覆盖**写入，而 `patchFileOf` 读 `process.env.DSH_HOME`、**为空时回退真实 `~/.dsh`**；cucumber 在同一进程串行跑场景、`process.env` 全局共享，场景间没有隔离保证，于是 `boot()` 设置/恢复 DSH_HOME 的窗口一漏就命中真实配置。修法：写入侧加 **fail-closed 路径断言**（目标落在真实 home 即抛错，绝不静默写）+ DSH_HOME 隔离提前到 `Before` / `beforeEach`，并加「DSH_HOME 缺失时写入必须抛错且真实文件 hash/mtime 零变化」的防回归用例
- `ghops pr checks` 报 CI 红但唯一失败项是 `github-advanced-security`，日志吐 `CAPIError: 400 The requested model is not supported`（`COPILOT_AGENT_MODEL: sweagent-capi:*`）→ 该 check **不对应本仓任何 workflow**（`dynamic` 事件、平台侧 Copilot「Code scanning AI findings」/Autofix，仓库代码改不了），判**非阻断**；CodeQL 覆盖面不受影响（`.github/workflows/codeql.yml` 的 `Analyze (actions)` / `Analyze (javascript-typescript)` 照常 success），不要按自己的 diff 排查，也不要试图改 `.github/workflows/`

## 插件运行时与宿主 API

> 详见 [宿主运行时陷阱.md](宿主运行时陷阱.md)、[插件资源占用.md](插件资源占用.md)

- 插件已加载但事件 0 触发、路由 404、日志无报错 → 监听器注册随插件 fiber 被回收，要挂到常驻 root
- 页签偶发变纯文字、图标与徽标消失、刷新页面即恢复 → 样式注入排在了服务判空早退之后
- `yield* (intermediate value) is not async iterable` → `llm/stream` 的 handler 写成 async，把流包成了 Promise
- 监听器 `return` 了值、发送方只拿到 `undefined`（聚合端点给每个插件编造"运行中"）→ `emit` 不收集返回值、`parallel` 不返回结果，收集返回值只能用 `serial`；详见 [宿主运行时陷阱.md](宿主运行时陷阱.md)
- 长会话 CPU 数百 %、内存 GB 级、磁盘每小时 GB 级写入 → 事件流误用全量快照原语；详见 [插件资源占用.md](插件资源占用.md)
- 状态文件停在旧内容且不报错，只有 `write blocked … dropping pending snapshot` → 调度器与快照原语双节流互斥；详见 [异步落盘与时序.md](异步落盘与时序.md)
- 要靠改宿主「硬编码且不持久化」的布局值（如右侧边栏首次打开宽度 45%），而 `ctx.layout` / `ctx.sidebarRight` 都没有宽度面 → 走**已注册 root 席位的 store 座位**：`ctx.slots.entries('root')` 找到 ui-layout 条目 → `entry.store.create()`（handle 形态；AppFrame 订阅的同一实例）→ `actions.setRightbar(px)`。只在快照字段为 `null`（本次运行尚无偏好）时写、非 handle 形态一律不猜调用、全链路 detect 静默降级 + `ctx.slots.subscribe('root', …)` 应对 HMR 重挂载；固化在 `plugins/dsh-file-activity/src/client/parts/rightbar-width.ts`，防回归 `plugins/dsh-file-activity/test/client-rightbar-width.mjs`

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
- fork 池里 pre-push verify 恒报「目标路径在临时目录之外时拒绝写入」失败（`24 通过 / 1 失败`），主工作区与 CI 都不复现 → 用例拿 `process.cwd()`（或仓库根）代表「临时目录之外的路径」，而 fork 池工作区就在 `$TMPDIR` 之下，前提不成立 → 每个 agent 只能 `HUSKY=0` 绕过，门禁形同虚设。改用 `join(dirname(tmpdir()), …)` **按构造**取（别用 `homedir()`——容器 `HOME=/tmp` 会重踩）。详见 [fork池工作流.md](fork池工作流.md)
