// Stryker 沙箱专用 Vitest 配置（继承 vitest.config.mjs）。
//
// 为什么单文件串行（fileParallelism: false）：stryker 的 dry run 在
// .stryker-tmp 沙箱里跑全量测试，沙箱内 node_modules 为符号链接、被测代码
// 已被 instrumented，7 个测试文件并行 + v8 coverage 收集时对 CPU 竞争极其
// 敏感（本机实测：并行 worker 的 600ms 定时器被延迟到数十秒，dry run 直接
// 超时；同一份代码串行 25s 稳定通过）。串行只影响 stryker 的 dry run 与
// 变异体测试时长（秒级），不影响 `npm test`（仍用 vitest.config.mjs 并行）。
//
// 为什么放宽 testTimeout：沙箱内的被测代码经过 instrumented（每次函数
// 进入/退出都有覆盖率埋点）+ 沙箱路径 IO，实测单文件耗时约为插件目录内
// 的 6 倍（354ms 的 teardown 测试在沙箱内会逼近默认 5000ms 上限并偶发
// 超时）。给沙箱内的测试 30s 上限，避免把「沙箱更慢」误判成测试失败。
import { defineConfig } from 'vitest/config'
import base from './vitest.config.mjs'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
