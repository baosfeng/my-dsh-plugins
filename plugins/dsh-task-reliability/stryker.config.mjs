// Stryker 变异测试配置（质量门禁第 7 项）
// 运行：npx stryker run（在插件目录内）
// mutate 针对 server 端全部 lib 文件：client.js 为 __ModuleLoader__ 格式
// （eval 加载 + 浏览器环境），变异后无法由 vitest 验证
// excludedMutations：字符串/模板字面量变异多为 label、错误文案、提示文本类
// 低价值变异（不改变控制流），排除后聚焦逻辑变异（条件/运算/调用/对象）
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mjs' },
  mutate: [
    'lib/index.js',
    'lib/constants.js',
    'lib/util.js',
    'lib/fence.js',
    'lib/text.js',
    'lib/repeat.js',
    'lib/store.js',
    'lib/verify.js',
    'lib/events.js',
    'lib/rescue.js',
    'lib/api.js',
    'lib/config-store.js',
    'lib/command.js',
  ],
  mutator: {
    excludedMutations: ['StringLiteral', 'TemplateLiteral'],
  },
  reporters: ['clear-text', 'progress'],
  thresholds: { high: 80, low: 60, break: 70 },
  concurrency: 4,
  timeoutMs: 30000,
}
