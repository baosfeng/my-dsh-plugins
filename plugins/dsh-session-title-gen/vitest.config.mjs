import { defineConfig } from 'vitest/config'
import root from '../../vitest.config.mjs'

export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: ['test/*.mjs'],
    coverage: {
      ...root.test.coverage,
      include: [
        'lib/index.js',
        'lib/title.js',
        'lib/workspace.js',
        'lib/host.js',
        'lib/generate.js',
        // 设置页配置面（issue #385）：默认值/规整 + HTTP 端点与写回
        'lib/config.js',
        'lib/config-routes.js',
      ],
    },
  },
})
