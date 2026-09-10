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
        'lib/config.js',
        'lib/context.js',
        'lib/fetch-patch.js',
        'lib/headers.js',
        'lib/session-value.js',
      ],
    },
  },
})
