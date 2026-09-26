import { defineConfig } from 'vitest/config'
import root from '../../vitest.config.mjs'

export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: ['test/*.mjs'],
    coverage: {
      ...root.test.coverage,
      include: ['lib/index.js', 'lib/api-route.js', 'lib/manage.js', 'lib/registry.js'],
    },
  },
})
