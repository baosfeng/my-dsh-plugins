import { defineConfig } from 'vitest/config'
import root from '../../vitest.config.mjs'

// client-only 插件：client 端为 __ModuleLoader__ 格式（eval 加载，
// v8 coverage 无法统计），由 text-fence-markdown / context-markdown /
// markdown-view-contract / client-render 断言 + Gherkin 场景覆盖；真实环境 /
// 浏览器功能级验证由用户本人人工自测（清单 verification/README.md），不在本仓
// 自动化；server 端（index.js + routes.js，配置 API）纳入覆盖率门禁
// （行 ≥85 / 分支 ≥75 / 函数 ≥80）。
export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: ['test/*.mjs'],
    coverage: {
      ...root.test.coverage,
      include: ['lib/index.js', 'lib/config.js', 'lib/prompt.js', 'lib/routes/config.js', 'lib/routes/assets.js'],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 80,
      },
    },
  },
})
