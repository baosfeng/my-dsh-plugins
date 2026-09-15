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
        'lib/guard.js',
        'lib/poison.js',
        'lib/tarball.js',
        'lib/injection.js',
        'lib/store.js',
        'lib/routes.js',
        'lib/fence.js',
        'lib/constants.js',
        'lib/custom-rules.js',
        'lib/notify.js',
      ],
    },
  },
})
