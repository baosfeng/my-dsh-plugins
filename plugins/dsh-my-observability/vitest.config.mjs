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
        'lib/audit.js',
        'lib/store.js',
        'lib/store-persist.js',
        'lib/resource-monitor.js',
        'lib/resource-rules.js',
        'lib/git.js',
        'lib/diff.js',
        'lib/review.js',
        'lib/ai.js',
        'lib/routes.js',
        'lib/config-routes.js',
        'lib/fence.js',
        'lib/constants.js',
      ],
    },
  },
})
