import { defineConfig } from 'vitest/config'
import root from '../../vitest.config.mjs'

export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: ['test/*.mjs'],
    coverage: {
      ...root.test.coverage,
      // 纯类型模块 types.js 无运行时语句，不纳入统计（避免 0/0 拖低分母）。
      include: [
        'lib/index.js',
        'lib/server/catalog.js',
        'lib/server/config-store.js',
        'lib/server/detail.js',
        'lib/server/diagnostics.js',
        'lib/server/disabler.js',
        'lib/server/http.js',
        'lib/server/usage.js',
      ],
    },
  },
})
