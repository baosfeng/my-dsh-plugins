---
title: llm/stream 包装 handler 误用 async 导致 yield* 委托崩溃
description: cordis waterfall 不 await listener 返回值；async handler 会把流包成 Promise，vision-toolkit 等用 yield* 委托流的适配器直接报 "yield* (intermediate value) is not async iterable"
status: 已解决
created: 2026-08-26
updated: 2026-08-26
---

# 聊天输入即报 `yield* (intermediate value) is not async iterable`

## 症状

在 DSH 聊天框输入任意消息发送，本轮立即失败，页面/会话日志显示
`yield* (intermediate value) is not async iterable`（`code: UNKNOWN`），
`auto-continue` 反复「继续」也全部失败。修复前只在特定模型路由下复现，
切换模型后消失。

## 根因（2026-08-26 定位，dsh-task-reliability v0.1.2）

`plugins/dsh-task-reliability/lib/events.js` 的 `llm/stream` handler 被写成
**async function**：

```js
async function handleStream(options, next, shared) {
  const stream = await next()
  return wrapStreamForLoop(stream, repeatStateOf(sessionId, shared))
}
```

cordis `waterfall` 的 `next()` 是**同步调用**内层函数（`adapterStream` 是
`async*`，调用即得 AsyncGenerator），且 waterfall **不 await listener 的
返回值**——async handler 让 waterfall 最终返回 `Promise<AsyncGenerator>`。

- `for await` 消费方能自动展开 Promise，所以普通 agent loop 路径不报错；
- 但 **vision-toolkit 的 `ImageInputVariantAdapter.stream()` 用
  `yield* this.llm.stream(...)` 委托流**，`yield*` 只接受 async iterable、
  **不接受 Promise**，迭代一开始就抛
  `yield* (intermediate value) is not async iterable`。

默认模型切到 `vision-toolkit-*` 变体路由后（`settings.yaml` 的
`agent-default-model.provider`），每次对话必现。

## 修复

`handleStream` 改为**同步函数**，`next()` 直接返回流，不做 `await`：

```js
function handleStream(options, next, shared) {
  const sessionId = typeof options?.sessionId === 'string' ? options.sessionId : ''
  if (sessionId === '') return next()
  const stream = next()
  return wrapStreamForLoop(stream, repeatStateOf(sessionId, shared))
}
```

已提交（dsh-task-reliability）。配套新增回归测试
（`test/host-smoke.mjs`：`yield*` 委托消费 llm/stream 返回值），
单测 + Gherkin 全绿。

## 解决参考

- **任何 `llm/stream` 的 waterfall listener 必须保持同步返回流**——
  async function 会把流包成 Promise，`for await` 消费方不报错但
  `yield*` 委托方（vision-toolkit 等适配器）直接崩。
- 写 `llm/stream` 测试时，`next` mock 必须用**同步函数**返回 generator
  （真实 cordis 形态）；用 `async () => generator` 的 mock 会掩盖这类回归。
- 排查线索：页面报错 `yield* (intermediate value) is not async iterable`
  先全盘搜 `yield*`（`grep -rnF "yield*" node_modules/`），再看谁包装了
  `llm/stream` 流。
