// scripts 测试专用 Vitest 配置：覆盖率统计 scripts/lib/ 下的纯函数模块
// （release-checks.mjs = 发版校验，issue #39；npm-audit.mjs = audit 门禁判定，issue #199；
// verify-profile.mjs = 隔离 profile 软链与解析路径校验，issue #220；
// screenshot-gate.mjs = README 效果图门禁判定与无 UI 豁免判据，issue #227；
// deps-matrix.mjs = 依赖矩阵的版本解析/分档/漂移判定，issue #184），
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
        'scripts/lib/deps-matrix.mjs',
      ],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 80,
      },
    },
  },
})
