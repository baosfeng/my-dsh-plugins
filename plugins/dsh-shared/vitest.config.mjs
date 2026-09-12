import { defineConfig } from 'vitest/config'
import root from '../../vitest.config.mjs'

// dsh-shared — 纯 server 端工具包：覆盖率统计 lib/ 下全部实现文件
// （lib/index.js 为纯 re-export 入口，v8 coverage 无法统计）。
// 阈值沿用根门禁（行≥85/分支≥75）。
export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: ['test/*.mjs'],
    coverage: {
      ...root.test.coverage,
      include: [
        'lib/fence.js',
        'lib/http.js',
        'lib/config-store.js',
        'lib/project.js',
        'lib/async.js',
        'lib/persist.js',
        'lib/jsonl.js',
        'lib/bounded.js',
        'lib/scheduler.js',
      ],
    },
  },
})
