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
        'lib/store.js',
        'lib/api-route.js',
        'lib/fence.js',
        'lib/http.js',
        'lib/memory-text.js',
        'lib/memory-scoring.js',
        'lib/extract.js',
        'lib/prompt.js',
        'lib/save-policy.js',
        'lib/tool.js',
      ],
    },
  },
})
