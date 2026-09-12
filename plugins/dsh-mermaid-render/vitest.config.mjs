import { defineConfig } from 'vitest/config'
import root from '../../vitest.config.mjs'

// server 端两半：lib/index.js（挂载 + section 注册）、lib/prompt.js（注入文案与开关，
// issue #194）。client 端（lib/client.js）为 __ModuleLoader__ 格式、经 eval 加载，
// v8 coverage 无法统计——由 test/client-render.mjs 断言 + Gherkin 场景 + 隔离实例
// 真实环境验证覆盖（见 docs/mermaid渲染/需求清单.md 回归检查）。
export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: ['test/*.mjs'],
    coverage: {
      ...root.test.coverage,
      include: ['lib/index.js', 'lib/prompt.js'],
    },
  },
})
