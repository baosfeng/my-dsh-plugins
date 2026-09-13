---
title: profile 插件 fiber 回收导致监听器静默失效
description: profile 插件的 ctx.on / ctx.effect 注册随插件 fiber 被 loader 回收而消失，事件 0 触发、路由 404 且无任何报错
created: 2026-09-13
updated: 2026-09-13
---

# profile 插件 fiber 回收导致监听器静默失效

> 关联：issue #242（影响面清单）、#232（首个案例：会话标题缺 `[工作区]` 前缀）
> 实测宿主：DSH 0.1.5-rc.1；实测环境：`scripts/verify-real-profile.mjs` 隔离实例 + 真实模型 + 真实浏览器。

## 一、症状

插件「加载成功」（`dump-config` 里有它、没有 disabled、apply 里也没有抛错），但：

- 它的 `session/event`（或其它宿主事件）监听器**从不触发**；
- 它注册的 HTTP 路由**返回 404**；
- 控制台/日志**没有任何错误或警告**。

用户侧表现为「功能没反应」，排查时最容易误判成「宿主没给数据」或「取值写错了」。

## 二、判定方法（可复制，3 分钟）

在插件 `apply` 里临时插桩（输出写文件最稳，隔离实例的 stderr 常被启动脚本吞掉）：

```ts
import { appendFileSync } from 'node:fs'

function probe(ctx: any, tag: string): void {
  const len = () => (ctx.events?._hooks?.['session/event'] ?? []).length
  const before = len()
  ctx.on('session/event', () => {}) // 注册一个空监听器
  const after = len()
  setTimeout(() => {
    const hooks = ctx.events?._hooks?.['session/event'] ?? []
    const owners = hooks.map((h: any) => h.ctx?.fiber?.name ?? 'unknown')
    appendFileSync(
      '/tmp/probe.log',
      `[${tag}] before=${before} after=${after} later=${hooks.length} owners=${owners.join(',')}\n`,
    )
  }, 9000)
}
```

**判读**：

| 观测                                                                                                  | 含义                                                                  |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `after > before` 但 `later` 回到 `before`，且 `owners` 里**没有本插件名**                             | **中招**：注册被回收，该插件所有 `ctx.on`/`ctx.effect` 注册都不会生效 |
| `later` 保持 `after`，`owners` 里有本插件名                                                           | 未中招，按正常路径排查                                                |
| 路由：`curl -H 'Host: 127.0.0.1:<port>' http://127.0.0.1:<port>/<你的前缀>/...` 返回 404 而插件已加载 | **中招**（路由同样随 fiber 回收）                                     |

实测样本（my-context，注册在插件自身 ctx）：

```text
[regprobe] listenCtxIsRoot=true before=12 selfAfter=13 selfError=none rootAfter=14 rootError=none
9 秒后：hooks 表长度回到 20，owner 列表 = dsh-my-guard,dsh-my-notify,dsh-my-memory,...（不含 dsh-my-context）
```

## 三、触发条件（实测边界）

- **不是**「profile 插件」的普遍规律：同一批加载的 5 个插件里，`dsh-my-guard`/`dsh-my-notify`/`dsh-my-memory`/`dsh-my-observability` 的 `ctx.on('session/event')` **正常触发 24 次**，`dsh-my-context` 触发 **0 次**（同一实例、同一 `inject`、同一写法）。
- **不是** `ctx.effect(() => ctx.on(...))` 写法导致：`dsh-my-memory` 用该写法仍正常触发。
- **具有时序/加载相关性**：同一插件在不同实例/不同重启轮次下表现可能不同（my-context 在某轮实例里 hook 留在表中、另一轮被回收）。
- **可判定的稳定事实**：注册的 **owner fiber 决定可达性** —— 注册落在**常驻 root fiber**（`hook.ctx.fiber.name` 为 `root`）的监听器始终生效；落在**会 plugins fiber 上**的注册，一旦该 fiber 被 loader 回收，注册即静默消失。
- 尚未定位：loader 在何种确切条件下回收某个插件的 fiber（与 patch reload / 加载顺序 / scope 创建的时序有关，未逐项二分）。

## 四、修法（插件侧接管，不等上游）

1. **监听器注册到 `ctx.root`**，并带 `{ global: true }` 跳过 scope 过滤：
   ```ts
   const listenCtx = (ctx as { root?: DshContext }).root ?? ctx
   listenCtx.on('session/event', handler, { global: true })
   ```
2. **路由/服务类注册不要经 `ctx.effect`**（会被一起回收）：直接调用宿主服务（如 `webServer.register(...)`）并把 disposer 自己保管。
3. **去重**：`ctx.root` 上的注册不随插件卸载自动清理，而 loader 会多次 apply 同一插件——用**以 root ctx 为键的 WeakMap** 保存 disposer，重复 apply 时先移除上一轮，避免同一事件被多份监听器重复处理。
4. **不要只靠 `ctx.effect` 做清理副作用**：`ctx.effect(() => store.dispose, ...)` 在 fiber 被回收时会**立即**执行 `store.dispose()`（实测会清掉持久化防抖定时器）；此类 teardown 同样应挂到 `ctx.root`。
5. **防回归测试**：用「self 表（模拟会被回收的插件 fiber，派发永不到达）+ root 表（模拟常驻 fiber）」两个分离注册表复刻语义，断言注册必须落在 root。参考 `plugins/dsh-my-context/test/host-root-registration.mjs`（把修复回退成 `ctx.on` 时该测试 RED）。

参考实现：`plugins/dsh-my-context/src/events.ts`（`rootListeners`）、`src/routes.ts`（`rootRoutes`）、`src/index.ts`。
