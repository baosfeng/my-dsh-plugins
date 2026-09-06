import { defineConfig } from 'vitest/config'
import root from '../../vitest.config.mjs'

export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: ['test/*.mjs'],
    coverage: {
      ...root.test.coverage,
      // P2 拆分后 server 端为多文件：只统计 server 子模块，排除浏览器端 client.js
      include: [
        'lib/index.js',
        'lib/state.js',
        'lib/fence.js',
        'lib/events.js',
        'lib/mount.js',
        'lib/api.js',
        'lib/dep-version.js',
        'lib/dep-precheck.js',
        'lib/startup-check.js',
      ],
    },
  },
})
