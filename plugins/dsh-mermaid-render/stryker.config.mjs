// Stryker 变异测试配置（质量门禁第 7 项）
// 运行：npx stryker run（在插件目录内）
// mutate 只针对 server 端 lib/index.js：client.js 为 __ModuleLoader__ 格式
// （eval 加载 + 浏览器环境），变异后无法由 vitest 验证
// excludedMutations：字符串/模板字面量变异多为 label、错误文案、路由注释类
// 低价值变异（不改变控制流），排除后聚焦逻辑变异（条件/运算/调用/对象）
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mjs' },
  mutate: ['lib/index.js', 'lib/prompt.js'],
  mutator: {
    excludedMutations: ['StringLiteral', 'TemplateLiteral'],
  },
  reporters: ['clear-text', 'progress', 'html', 'json'],
  thresholds: { high: 80, low: 60, break: 70 },
  jsonReporter: { fileName: 'reports/mutation/mutation-report.json' },
  incremental: true,
  incrementalFile: 'reports/mutation/incremental.json',
  concurrency: 4,
  timeoutMs: 30000,
}
