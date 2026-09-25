// 根级 Vitest 配置（质量门禁）：所有插件测试 + 覆盖率阈值
// 各插件 npm test 通过插件目录内 vitest.config.mjs（继承本配置）运行
// 覆盖率只统计 server 端 lib/index.js：client 端（__ModuleLoader__ 格式）经 eval
// 加载，v8 coverage 无法统计（由 client-render 断言 + Gherkin + 真实环境验证覆盖）
//
// 为什么放宽 testTimeout/hookTimeout 到 60s（issue #353）：
//   vitest 默认 5s 是给**纯单测**的上限，而本仓有大量**进程级/端到端**用例（spawn node +
//   commitlint/gitleaks、重建 client bundle）。这些用例低负载 0.3~0.7s、多 agent 并行
//   （load 24~157）时 6~17s —— 撞 5s 默认上限即「本地红、CI 绿」的假红（CI 单 job 独占，
//   本地并发跑插件测试）。超时上限是**停机保护**，不是正确性判据。
//   ⚠️ 放宽框架超时 ≠ 放宽判据：前者是「允许慢」，后者是「允许错」。断言本身仍必须是
//   负载无关的（行为/相对/分布判据），绝不允许用「调大阈值」换绿 —— 见
//   docs/踩坑/异步落盘与时序.md「绝对耗时断言」一节。
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// 测试临时目录兜底清扫（有界策略）：见 scripts/test/tmp-residue-sweep.mjs。
// 必须用绝对路径 —— 插件 config 以 `...root` 继承本配置，相对路径会相对插件目录解析。
const tmpResidueSweep = fileURLToPath(new URL('./scripts/test/tmp-residue-sweep.mjs', import.meta.url))

export default defineConfig({
  test: {
    include: ['test/*.mjs'],
    exclude: ['**/e2e-cdp.mjs', '**/node_modules/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globalSetup: [tmpResidueSweep],
    coverage: {
      provider: 'v8',
      include: ['lib/index.js'],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 80,
      },
    },
  },
})
