---
title: 固定 sleep 等异步落盘导致 CI flaky（时序竞态）
description: 测试用 setTimeout 固定等待异步加载/落盘，CI 容器高负载下等待不足 → 随机红；修法是给实现加确定性就绪信号（whenReady）+ 测试用条件轮询，让查询语义与加载耗时无关，而不是把 sleep 调大
created: 2026-09-11
updated: 2026-09-11
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

## 相关

- `plugins/dsh-my-guard/src/store.ts`（`whenReady` / 未就绪不落盘 / 原地合并）、`plugins/dsh-my-guard/src/routes.ts`（API 分派前等就绪）
- `plugins/dsh-my-guard/test/lib/helpers.mjs`（`waitFor` 条件轮询、`readJsonFile`；`settle` 的注释已写明适用边界）
- `docs/踩坑/本地绿不等于CI绿.md`（"本地绿 ≠ CI 绿"的另一形态：环境差异）、`docs/踩坑/多agent并行测试资源冲突.md`（测试环境类踩坑）
