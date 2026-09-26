// Stryker 变异测试配置（质量门禁第 7 项）
// 运行：npx stryker run（在插件目录内）
// mutate 只针对 server 端 lib/index.js：client.js 为 __ModuleLoader__ 格式
// （eval 加载 + 浏览器环境），变异后无法由 vitest 验证
// 注意：lib/index.js 只含 name / inject / apply（配置面），不排除 StringLiteral
// 变异——name 字符串变异由 host-smoke.mjs 断言捕获
export default {
  testRunner: 'vitest',
  coverageAnalysis: 'all',
  vitest: { configFile: 'vitest.config.mjs', related: false },
  mutate: ['lib/index.js'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  thresholds: { high: 80, low: 60, break: 70 },
  jsonReporter: { fileName: 'reports/mutation/mutation-report.json' },
  incremental: true,
  incrementalFile: 'reports/mutation/incremental.json',
  concurrency: 4,
}
