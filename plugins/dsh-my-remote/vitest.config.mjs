import { defineConfig } from 'vitest/config'
import root from '../../vitest.config.mjs'

export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: ['test/*.mjs'],
    // 全局隔离 DSH_HOME（真实事故防复发）：首个用例之前就指向临时目录。
    setupFiles: ['./test/helpers/isolate-setup.mjs'],
    coverage: {
      ...root.test.coverage,
      include: [
        'lib/index.js',
        'lib/events.js',
        'lib/registries.js',
        'lib/channels.js',
        'lib/commands.js',
        'lib/routes.js',
        // 设置页新增模块（issue #385）：不进 include 就等于新增代码在覆盖率门禁外。
        'lib/settings.js',
        'lib/settings-model.js',
        'lib/settings-store.js',
        'lib/settings-yaml.js',
      ],
    },
  },
})
