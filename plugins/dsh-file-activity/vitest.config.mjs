import { defineConfig } from 'vitest/config'
import root from '../../vitest.config.mjs'

export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: ['test/*.mjs'],
    // test/state-file.mjs 是辅助模块（无 test 用例），不作为测试文件收集
    exclude: [...(root.test.exclude ?? []), 'test/state-file.mjs'],
    coverage: {
      ...root.test.coverage,
      include: ['lib/index.js'],
    },
  },
})
