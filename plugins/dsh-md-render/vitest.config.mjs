import { defineConfig } from 'vitest/config'
import root from '../../vitest.config.mjs'

// client-only 插件：client 端为 __ModuleLoader__ 格式（eval 加载，
// v8 coverage 无法统计），由 text-fence-markdown / context-markdown /
// markdown-view-contract / client-render 断言 + Gherkin 场景 + 真实环境验证
// 覆盖；server 端（index.js + routes.js，配置 API）纳入覆盖率门禁
// （行 ≥85 / 分支 ≥75 / 函数 ≥80）。
export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: ['test/*.mjs'],
    coverage: {
      ...root.test.coverage,
      include: ['lib/index.js', 'lib/routes.js'],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 80,
      },
    },
  },
})
