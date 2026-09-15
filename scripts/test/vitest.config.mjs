// scripts 测试专用 Vitest 配置：覆盖率统计 scripts/lib/ 下的纯函数模块
// （release-checks.mjs = 发版校验，issue #39；npm-audit.mjs = audit 门禁判定，issue #199；
// verify-profile.mjs = 隔离 profile 软链与解析路径校验，issue #220；
// screenshot-gate.mjs = README 效果图门禁判定与无 UI 豁免判据，issue #227；
// preset-gate.mjs = agent preset 资产包形态判定与门禁豁免判据，issue #231；
// deps-matrix.mjs = 依赖矩阵的版本解析/分档/漂移判定，issue #184；
// fork-pool.mjs = fork 池的参数解析/路径推导/基线判定/清理护栏，issue #240；
// ship-pipeline.mjs = 提交流水线的 fail-closed 判据/步骤清单/结果渲染，issue #240；
// release-timing.mjs = 发版阶段耗时表，issue #246；
// release-concurrency.mjs = 发版有界并发调度，issue #246；
// pack-hygiene.mjs = 包发布卫生判定（字段自洽 / pack 内容 / README 引用面），issue #323；
// verify-checklist.mjs = 验证清单的渲染/幂等合并/#67 门禁判定，issue #329），
// 阈值与根配置一致（行 85 / 分支 75 / 函数 80）。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/test/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: [
        'scripts/lib/release-checks.mjs',
        'scripts/lib/npm-audit.mjs',
        'scripts/lib/verify-profile.mjs',
        'scripts/lib/screenshot-gate.mjs',
        'scripts/lib/preset-gate.mjs',
        'scripts/lib/deps-matrix.mjs',
        'scripts/lib/fork-pool.mjs',
        'scripts/lib/ship-pipeline.mjs',
        'scripts/lib/release-timing.mjs',
        'scripts/lib/release-concurrency.mjs',
        'scripts/lib/pack-hygiene.mjs',
        'scripts/lib/verify-checklist.mjs',
      ],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 80,
      },
    },
  },
})
