// 质量门禁：vitest 覆盖率（行 ≥85 / 分支 ≥75 / 函数 ≥80），只统计 server 端 lib 子模块
// （P2 拆分后为多文件；client.js 为浏览器端 __ModuleLoader__ 格式，排除）。
// 清单必须与 lib/ 下真实存在的 .js 产物一致（历史上曾引用已删除的 lib/fence.js，
// 导致覆盖率统计静默漏项——见 CHANGELOG 的 TS 迁移条目）。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/*.mjs'],
    exclude: ['**/e2e-cdp.mjs', '**/node_modules/**'],
    // 本插件不继承根配置，需自行声明（issue #353）：真实落盘用例写 20000 条任务，
    // 多 agent 并行负载下极易顶穿 vitest 默认 5s。放宽的是框架停机保护，不是判据。
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // 测试通过 process.env.DSH_HOME 指向各用例的临时目录；文件并行会互相污染该
    // 全局环境变量，必须顺序执行测试文件。
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: [
        'lib/index.js',
        'lib/constants.js',
        'lib/util.js',
        'lib/text.js',
        'lib/repeat.js',
        'lib/loop.js',
        'lib/store.js',
        'lib/verify.js',
        'lib/events.js',
        'lib/rescue.js',
        'lib/api.js',
        'lib/ask.js',
        'lib/emit.js',
        'lib/command.js',
      ],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 80,
      },
    },
  },
})
