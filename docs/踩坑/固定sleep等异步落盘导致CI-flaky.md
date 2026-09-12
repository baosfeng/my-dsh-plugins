---
title: 固定 sleep 等异步落盘导致 CI flaky（时序竞态）
description: 测试用 setTimeout 固定等待异步加载/落盘，CI 容器高负载下等待不足 → 随机红；修法是给实现加确定性就绪信号（whenReady）+ 测试用条件轮询，让查询语义与加载耗时无关，而不是把 sleep 调大
created: 2026-09-11
updated: 2026-09-12
---

# 固定 sleep 等异步落盘导致 CI flaky（时序竞态）

## 现象

CI（job「插件测试（19 个）」）里 `plugins/dsh-my-guard` 单独红一条：

```text
FAIL test/host-store.mjs > alerts recorded before load completes are buffered, not lost
AssertionError: buffered alert merged with loaded state
  Expected: 2, Received: 1
  ❯ test/host-store.mjs:105:10
     103| await settle(600)
     105| assert.equal(alerts.length, 2, ...)
```

该用例耗时 1273ms；同 job 其余 18 个插件全绿；同一提交在本地 `npx vitest run test/host-store.mjs` **连跑 6 次全绿**（10 tests passed，约 3.4s/次）；上一次跑同样代码的 CI（run 16）也是 SUCCESS。典型 flaky：**只在 CI 容器高负载下红**。

失败用例的等待方式（修复前）：

```js
await dispatch(second.listeners, bashExec('s-2', 'rm -rf /'), async () => ({ kind: 'allow' }))
await settle(600) // ← 固定 600ms 等"异步加载 + 防抖落盘"
const alerts = await fetchAlerts(second.api) // 内部还有 settle(60)
assert.equal(alerts.length, 2, 'buffered alert merged with loaded state')
```

## 根因

`settle(ms)` 就是 `setTimeout(ms)`——**它不表达任何条件，只表达"我猜够了"**。而这里要等的是两件异步事：

1. `createStore()` 启动时的 `readFile`（磁盘历史告警，异步 IO）；
2. 加载完成前的告警先进 `pending` 缓冲，加载完成后才 splice 合并进 state。

查询侧（`/guard/api/alerts`）只读已加载的 state。于是**查询结果取决于"加载是否已跑完"这一墙钟事实**：CI 容器被 19 个插件的测试挤到高负载时，`readFile` 的回调在 660ms 内没轮到 → 查询只看到已加载的 1 条（磁盘历史），pending 里的第 2 条还没合并 → 断言 2 vs 1 失败。

**关键判断：这不是"sleep 太短"，而是竞态被 sleep 掩盖。** 证据：写死等待去掉后（`fetchAlerts` 不再 settle、用例不再 settle），同一文件 **10 条用例全部确定性失败**（`0 !== 1`、`0 !== 2`、`TypeError: Cannot read properties of undefined`）——说明"查询/确认依赖加载完成"这条竞态是结构性的，原先每条用例都在各自的 sleep 窗口里**赌**加载已完成；谁先赌输谁红。把 600 调成 2000 只是让下一次在更慢的机器/更高的负载下再红一次。

顺带暴露的第二个缺陷：`dispose()` 在加载完成前被调用时，会把 `pending` 直接合并进**只有新告警、没有磁盘历史**的内存状态并立即落盘——真实 teardown（进程随后退出，防抖写不再发生）时磁盘历史被永久覆盖丢失。它同样是"依赖墙钟"的：加载读到的是旧内容还是已被自己覆盖的内容，取决于读写赛跑。

## 确定性复现（不靠"造负载"，本地 100% 复现）

两条互补用例，都不依赖机器快慢：

```js
// 1) 零等待查询：boot 后立即记录 → 立刻查（此刻 readFile 一定还没完成，
//    它至少需要一个 IO tick）→ 修复前稳定 0 !== 1
await dispatch(listeners, bashExec('s-1', 'rm -rf /'), async () => ({ kind: 'allow' }))
const alerts = await fetchAlerts(api)
assert.equal(alerts.length, 1, 'boot 后立即记录的告警必须可查询')

// 2) 注入受控慢加载：读盘被 gate 挂起 → 确定性地构造"加载慢于事件到达"
const gate = deferred()
const store = createStore(
  {},
  {
    readFile: async () => {
      await gate.promise
      return readFileSync(file, 'utf8')
    },
  },
)
const buffered = store.record({/* …加载期间产生的告警… */})
gate.resolve()
await store.whenReady() // ← 确定性信号（修复前：TypeError，接口不存在）
assert.equal(store.count(), 2, '磁盘历史 + 缓冲告警')
```

修复前的失败输出（本机，`npx vitest run test/host-store.mjs`）：

```text
 FAIL  test/host-store.mjs > alerts recorded right after boot are queryable without any wall-clock wait
AssertionError: boot 后立即记录的告警必须可查询
0 !== 1

 FAIL  test/host-store.mjs > store: slow load merges buffered alerts deterministically (injected load gate)
TypeError: store.whenReady is not a function

 FAIL  test/host-store.mjs > store: dispose while load is pending persists history + buffered alerts at once
AssertionError: 卸载后的首次落盘必须包含磁盘历史
1 !== 2

      Tests  10 failed | 3 passed (13)
```

第三条用注入的 `writeFile` 记录**落盘快照序列**，断言"卸载后的首次落盘就必须含磁盘历史"——这正是"读写赛跑"的可判定形式（不看最终内容，看第一次写出去的是什么），因此不受本机快慢影响。

## 修法

**1）实现侧：把"就绪"变成可等待的信号，并让查询语义与加载耗时无关**

- `AlertStore` 新增 `whenReady(): Promise<void>`：`onLoaded` 里先合并磁盘历史 + 回放 `pending`，**再** resolve（顺序保证"whenReady 之后查询必含缓冲告警"）。
- `/guard/api` 统一 handler 在分派前 `await store.whenReady()`：`/alerts`、`/status`、`/confirm` 不再可能读到"半加载"状态（`whenReady` 在就绪后立即 resolve，无可感知延迟）。
- `dispose()` 若加载尚未完成，改为等合并完成后落盘（`readyPromise.then(() => persistNow())`），不再拿"缺历史"的状态覆盖磁盘；`onLoaded` 之后的防抖写也不再挂到已卸载的 store 上。
- `onLoaded` 合并时**原地替换 `state.alerts` 数组**，不再整体换 `state` 对象（`AlertStore.state` 已被外部持有，换对象会让持有者永远停在旧数组上）。

**2）测试侧：区分"等出现"与"等不发生"**

- 等异步结果**出现** → 条件轮询 `waitFor(predicate, { timeout, message })`（超时抛出带原因的错误，而不是静默过期），或 `await store.whenReady()` 这类事件信号。
- 等**真实时间语义**（防抖窗口本身）→ 保留固定等待 + 注释说明等的是什么。
- 断言某事**没发生**（"不应产生告警"）→ 没有正向信号可等，保留观察窗口并在注释里写明理由。
- 把"等 microtask 跑完"的 `settle(40)` 改成 `settle(0)`：`setTimeout(0)` 必然晚于已排队的 microtask，语义精确且与机器负载无关。

效果：`test/host-store.mjs` 从 3.4s（净是 sleep）降到 **64ms**，13 条用例全绿；整个插件 vitest 170 条全绿、覆盖率不降（store.js 98.9% lines）。

**不要做的**：把 `settle(600)` 改成 `settle(2000)`、给用例加 `retry`、或把断言放宽成 `>= 1`——三种都只是把"随机红"换成"随机慢/随机漏"。

## 通用教训

- **测试里的 `setTimeout`/`sleep` 是一个"我不知道什么时候完成"的自白**。看到它就问：有没有可等待的信号（promise、事件、状态位）？没有就在实现里补一个——补信号比调大数字便宜得多。
- **"等异步结果"和"等一段时间"必须区分**：前者一律条件轮询；后者（防抖窗口、负向断言）才允许固定等待，且要写明窗口在表达什么。
- **CI 高负载是放大镜，不是根因**：本地不复现 ≠ 不是 bug（同 `docs/踩坑/本地绿不等于CI绿.md`）。判据是"断言是否依赖墙钟"，而不是"本地跑几次红不红"。
- **构造竞态要用注入，不要用负载**：注入受控 `readFile`/`writeFile`（gate、快照记录）能把"加载慢于事件到达"变成 100% 可复现的本地用例；靠 `stress`/`nice` 造负载得到的复现是概率性的，不能进 CI。
- **排查手法**：把所有 `settle(...)`/sleep 一次删掉再跑——凡是变红的用例都依赖墙钟（本次一删就红 10/13，直接给出完整清单）。

## 复发实例（2026-09-12）：dsh-my-observability / dsh-my-guardian

**同一根因在另外两个插件上再次打红 CI**（docs-only 提交上忽红忽绿，run
[#34626466982](https://github.com/baosfeng/my-dsh-plugins/actions/runs/34626466982)、
[#34620615204](https://github.com/baosfeng/my-dsh-plugins/actions/runs/34620615204)）：

| 插件                                           | 断言                                   | 机制                                                                             |
| ---------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| dsh-my-observability `test/host-audit.mjs:471` | `0 !== 1`（重启后事件丢失）            | 第二次 boot 后靠 `settle(40)` 赌异步 `readFile` 跑完；慢机器上查询读到空 state   |
| dsh-my-guardian `test/host-smoke.mjs:197`      | `state.staged['bad-plugin']` undefined | 读 state.json 前靠 `sleep(100)`；实测 boot 后 t0 该文件**还不存在**（t100 才有） |
| dsh-my-guardian `test/host-smoke.mjs:271`      | `Cannot read properties of undefined`  | 同上（冲突记录的落盘晚于读取）                                                   |
| dsh-my-guardian `test/host-edge.mjs:402`       | `404 !== 200`                          | API 在 `loadState` 完成前被调用 → `retryEntry` 返回 null → 404                   |

**确定性复现（不靠造负载）**：boot 后零等待查询/读 state —— 修复前 observability
稳定得 `0`（期望 1），guardian 读 state.json 稳定得 ENOENT；等 40ms 才得 1。
本机 10 轮全绿（本机快，40ms 够）正是"本地绿 ≠ CI 绿"。

**修法（与 dsh-my-guard 同一范式，实现侧补确定性信号 + 测试侧条件轮询）**：

- `dsh-my-observability`：`AuditStore.whenReady()`（`onLoaded` 合并/回放**之后** resolve）；
  `/observability/api` 统一 handler 分派前 `await store.whenReady()`——查询语义与加载耗时无关。
- `dsh-my-guardian`：`shared.flushPersist()`（写链 drain）+ `shared.bootPromise`
  （启动扫描完成信号，`initialScan` 的 `finally` 里 resolve，API 分派前 await）；
  **teardown 的 disposer 改为 async 并返回 drain promise**——此前 fire-and-forget +
  `sleep(60)` 是在赌写盘跑完，赌输时旧实例的延迟快照会覆盖下一个用例块写入的
  state.json（正是 host-edge 那条 404 的来源）。测试侧 `shutdown()` 改
  `await teardown.disposer()`，读持久化前的 `sleep` 改 `waitFor(条件)`；
  负向断言（"没有发生"）保留观察窗口并注明理由。

**结论**：`sleep` 只是"我不知道什么时候完成"的自白。**判据是"断言是否依赖墙钟"，
不是"本地跑几次红不红"**——删掉全部 sleep 定位依赖墙钟的用例，再在实现侧补信号，
比调大数字便宜得多（本次 host-edge 3.9s → 0.77s，host-smoke 保持 0.44s，全绿）。

## 复发实例二（2026-09-12）：#189 修完仍偶发 —— 被漏掉的第三条启动异步链（issue #217）

**现象**：PR #216（mermaid 提示词，未触碰 guardian）CI 首跑 `test (dsh-my-guardian)` failure，
同 commit 本地 `npm test` 89 tests / 12 scenarios 全绿，main 同 base 该 job success，
推空提交重跑全绿——与提交内容无关的偶发红。**该 job 的原始日志取不到**
（`ghops actions logs` 返回的 run 日志集合里没有这个 job），因此判定只能走
"断言是否依赖墙钟"这条路，而不是"日志里红在哪一行"。

**残留窗口**：guardian 的启动期其实有**三条**异步链，而 #189 只给了其中两条确定性信号：

| 异步链                                                     | 入口                                  | #189 给的信号                         | 结果                        |
| ---------------------------------------------------------- | ------------------------------------- | ------------------------------------- | --------------------------- |
| initialScan（loadState + staged/promoted 挂载 + API 注册） | `src/index.ts:141`                    | `bootPromise`（`finally` 里 resolve） | ✅                          |
| teardown 卸载 + 写链                                       | `src/index.ts:213`                    | async disposer 返回 `flushPersist()`  | ✅ 但只 drain「已排队的写」 |
| **启动名册静态预检 runStartupCheck**                       | `src/index.ts:136`（fire-and-forget） | **无**                                | ❌                          |

`runStartupCheck` 是 `void` 出去的独立链，它自己会 `await writeStartupIssuesFile()`，
然后（仅当名册有问题时）`shared.persistSoon()`（`src/startup-check.ts:225`）。于是：

1. **API 读到半加载快照**：`/guardian/api` 分派前只 `await shared.bootPromise`（`src/api.ts:96`），
   预检未完成时 `snapshot.startupIssues` 是空数组；
2. **旧实例在 teardown 之后仍在写盘**：`flushPersist()` 只能 drain「已经排队的写」，
   预检的 `persistSoon` 可能晚于 teardown 返回才入链 → 用一个**缺少下一个用例块内容**
   的旧快照覆盖共享 `state.json`。这正是本文件上面那个跨实例竞态的另一半，
   当时的可复现样本（host-edge 的 404）走的是 unmount 那条路径。

**测试侧同源的墙钟依赖**（#189 只改了 host-smoke / host-edge，以下都没改）：

| 位置                                               | 写法                                             | 性质                               |
| -------------------------------------------------- | ------------------------------------------------ | ---------------------------------- |
| `test/startup-check.mjs:280`                       | `sleep(250)` 后断言挂载 / 报告 / 事件 / snapshot | 正向断言，慢 CI 必红               |
| `test/startup-check.mjs:324`                       | `sleep(250)` 后读报告文件                        | 正向（ENOENT 即红）                |
| `test/startup-check.mjs:368`                       | `sleep(150)` 等预检跑完再 teardown               | 赌 teardown 抢在预检前             |
| `test/host-mutation.mjs:149`                       | `boot()` 里 `sleep(150)`                         | 正向（callApi 里 assert apiRoute） |
| `test/host-mutation.mjs:230`                       | `sleep(250)` 后读 state.json 事件                | 正向                               |
| `test/dep-precheck.mjs:174 / 188 / 209 / 225`      | `sleep(60)` + `sleep(200)`×3                     | 正向                               |
| `test/features/steps/guardian.steps.mjs:101 / 157` | `sleep(150)` + `sleep(60)`                       | 正向                               |

**确定性复现（不造负载，本机 4/4 稳定红）**，四条互补：

```js
// A) 零墙钟：apply 后立刻 await teardown，返回即同步读盘
apply(ctx)
await teardownOf(ctx).disposer()
readStateOrNull(dir).events.some((e) => e.type === 'startup-issue') // 修复前 false
// B) 跨实例污染：teardown 后写哨兵，再等旧实例的预检报告落盘
writeFileSync(stateFile, JSON.stringify(sentinel))
//    修复前：哨兵被旧实例的延迟快照覆盖 → promoted.sentinel 消失
// C) 受控慢 IO：vi.mock('node:fs/promises') 注入 gate 挂起 startup-issues.json 的写入，
//    预检被挂起时 await callApi(GET state) → 修复前立刻返回且 startupIssues 为空（0 !== 1）
// D) teardown 后手动触发旧实例的轮询 tick（staged 文件里放新候选）
//    修复前：重新扫描 → 挂载 → persistSoon → 覆盖哨兵
```

修复前输出 `Tests 4 failed (4)`，修复后 `Tests 4 passed (4)`；用例永久保留在
`plugins/dsh-my-guardian/test/host-boot-readiness.mjs`。

**修法（对齐本文件既有原则：补信号，不调数字）**：

- `bootPromise` 的语义补完整：`markBooted` 改在 `Promise.all([initialScan, runStartupCheck])`
  都 settle 之后调用——「启动就绪」= 启动期**全部**异步链完成，API 查询与 teardown 因此
  都与启动耗时无关。
- teardown 先进入收尾态、再等启动路径：`disposed = true` + `ready = false` →
  `await bootPromise` → 卸载 → `persistFinal()`（收尾快照，唯一允许绕过 `disposed` 的写）
  → `await flushPersist()`。
- **防御纵深**：`persistSoon` 在 `disposed` 之后直接丢弃；`initialScan` 在 `disposed` 时
  不把 `ready` 置回 true。这样 watcher 回调 / 轮询 tick / 飞行中的 HTTP handler
  这些**没有被 await 覆盖**的入口也不会再写盘——否则下次新增一条 fire-and-forget
  路径就会重演同一个 bug。
- 测试侧：`sleep` 全部换成条件轮询 `waitFor` 或确定性同步点（API 注册 = initialScan 完成）；
  `shutdown()` 一律 `await teardown.disposer()`。另修两处**被 sleep 掩盖的共享状态假设**：
  `resetState()` 现在会删掉上一个用例残留的 `startup-issues.json`（否则「读到报告」
  并不等于「本次 boot 的报告已写出」）；「三次失败冻结」用例的三个实例改为**顺序**重启
  （此前三个实例同时存活、各自 persistSoon 同一份 `state.json`，谁后落盘谁说了算）。

**效果**：插件测试 2.95s → 1.09s（startup-check 668→35ms、host-mutation 2735→173ms、
dep-precheck 810→50ms）；89→93 tests，覆盖率不降（stmts 90.85 / branch 77.49）。

**教训**：一个模块有**多条**启动期异步链时，"给 boot 加一个信号"必须逐条清点——
`Promise.all` 里漏掉一条就等于没有信号。判据是「所有会写盘的路径是否都在某个可 await
的信号之内」，而不是「主要的那条加了没有」；同时"teardown 不再写盘"最好由**实现**
保证（收尾态 + 丢弃延迟写），而不是靠"恰好 await 了每一条已知路径"。

## 相关

- `plugins/dsh-my-observability/src/store.ts`（`whenReady`）、`src/routes.ts`（分派前等就绪）
- `plugins/dsh-my-guardian/src/state.ts`（`flushPersist`/`bootPromise`）、`src/api.ts`（分派前等 boot）、`src/index.ts`（teardown 返回 drain promise）
- `plugins/dsh-my-guard/src/store.ts`（`whenReady` / 未就绪不落盘 / 原地合并）、`plugins/dsh-my-guard/src/routes.ts`（API 分派前等就绪）
- `plugins/dsh-my-guard/test/lib/helpers.mjs`（`waitFor` 条件轮询、`readJsonFile`；`settle` 的注释已写明适用边界）
- `docs/踩坑/本地绿不等于CI绿.md`（"本地绿 ≠ CI 绿"的另一形态：环境差异）、`docs/踩坑/多agent并行测试资源冲突.md`（测试环境类踩坑）
