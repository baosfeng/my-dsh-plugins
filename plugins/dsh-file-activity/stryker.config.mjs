// Stryker 变异测试配置（质量门禁第 7 项）
// 运行：npx stryker run（在插件目录内）
// mutate 只针对 server 端 lib/index.js：client.js 为 __ModuleLoader__ 格式
// （eval 加载 + 浏览器环境），变异后无法由 vitest 验证
// excludedMutations：字符串/模板字面量变异多为 label、错误文案、路由注释类
// 低价值变异（不改变控制流），排除后聚焦逻辑变异（条件/运算/调用/对象）
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.stryker.config.mjs' },
  mutate: ['lib/index.js'],
  // TS 迁移（issue #47 同族）：本插件现在带 tsconfig.json，stryker 的沙箱
  // TSConfigPreprocessor 会重写它并调用 ts.parseConfigFileTextToJson ——
  // TypeScript 7（原生编译器）已不再导出该 API，直接崩溃。变异目标只有
  // lib/*.js（tsc 产物），测试是 .mjs，vitest 不读 tsconfig，沙箱重写本
  // 无意义；指向一个不存在的文件名即可让 preprocessor 跳过（找不到文件
  // 就不重写）。
  tsconfigFile: 'tsconfig.stryker-skip.json',
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
