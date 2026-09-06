// 根级质量门禁 ESLint 配置（flat config）
// 门禁：圈复杂度 ≤ 10；单文件 ≤ 400 行；单函数 ≤ 70 行（仅针对 lib/ 业务代码）
// 尺寸阈值说明（issue #44 引入 prettier 后调整）：行数是 printWidth 的因变量——
// 同样的代码 prettier 格式化后行数增加约 20-27%（长行拆开），格式化前
// "≤40 行/≤300 行"的合规文件格式化后普遍超限（实测 21 个函数 41-65 行、
// 4 个文件 302-382 行）。行数不再是稳定的代码量度量，复杂度规则
// （complexity ≤ 10）才是本质门禁（全部通过）；阈值 400/70 仍为合理上限。
// import/no-unresolved：require/import 的模块必须存在（issue #48，拦截
// require 不存在模块的低级错误，如 #39 的 require('dsh-md-render') 拼写错）
// 说明：lib/client*.js 为浏览器模块加载器格式（window.__ModuleLoader__.load），
//       非标准 Node ESM，单独配置 globals 与 sourceType。
import js from '@eslint/js'
import globals from 'globals'
import importPlugin from 'eslint-plugin-import'

// import/no-unresolved 的 resolver 设置（server + client + 测试共用）：
// node resolver 默认查找 node_modules；moduleDirectory 追加 plugins/ 使
// client 端 require('dsh-md-render') 等跨插件模块映射到仓库内
// plugins/<name>/ 真实检查（DSH 运行时按插件名提供模块，仓库内即
// plugins/<name>/，require 不存在的 dsh-* 包 → lint 报错）。
// react / react-dom 为 DSH 运行时注入的浏览器模块，node_modules 无对应
// 包，在 client 端规则里用 ignore 豁免（见下）。
const importSettings = {
  'import/resolver': {
    node: { moduleDirectory: ['node_modules', 'plugins'] },
  },
}

export default [
  {
    // 构建产物与工具临时产物不 lint：client.js 由 client.src.js 模板生成
    // （mermaid 产物内嵌 8.9MB base64，ESLint 正则规则会崩溃）；
    // **/coverage 为 vitest 覆盖率产物、**/.stryker-tmp 为变异测试 sandbox、
    // **/reports 为 Stryker 报告产物（各插件目录下）
    ignores: [
      '**/dist/',
      '**/coverage/',
      '**/node_modules/',
      '**/.stryker-tmp/',
      '**/reports/',
      // client.js 构建产物（由 client.src.js 模板 + lib/parts/ 片段经
      // scripts/build.mjs 拼接生成）：产物行数 = 源码总和，尺寸规则只查源；
      // mermaid 产物内嵌 8.9MB base64，ESLint 正则规则会崩溃
      'plugins/dsh-mermaid-render/lib/client.js',
      'plugins/dsh-file-activity/lib/client.js',
      'plugins/dsh-my-notify/lib/client.js',
      'plugins/dsh-think-zh-expand/lib/client.js',
      'plugins/dsh-my-guardian/lib/client.js',
      'plugins/dsh-my-skill-manager/lib/client.js',
      'plugins/dsh-my-memory/lib/client.js',
      'plugins/dsh-my-observability/lib/client.js',
      'plugins/dsh-my-guard/lib/client.js',
      'plugins/dsh-my-context/lib/client.js',
      // TS 插件（issue #47）：tsc 编译产物（src/*.ts → lib/*.js），格式由
      // tsc 生成（分号/缩进与 prettier 不一致），尺寸规则只查 TS 源码
      'plugins/dsh-ts-example/lib/index.js',
      'plugins/dsh-ts-example/lib/greeting.js',
    ],
  },
  {
    // server 端业务代码：lib/ 下除 client 外的所有文件（P2 拆分后 index.js
    // 拆分为 state/fence/events/mount/api 等子模块，尺寸规则一并覆盖）
    files: ['plugins/**/lib/*.js'],
    ignores: ['plugins/**/lib/client.js', 'plugins/**/lib/client.src.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: { import: importPlugin },
    settings: importSettings,
    rules: {
      ...js.configs.recommended.rules,
      complexity: ['error', 10],
      'max-lines': ['error', 400],
      'max-lines-per-function': ['error', 70],
      // server 端：import/require 的模块必须存在（node: 内置与相对路径
      // 由 node resolver 检查；commonjs: true 使 require() 调用也被检查）
      'import/no-unresolved': ['error', { commonjs: true }],
    },
  },
  {
    // 浏览器端源码（模块加载器格式，非标准 ESM）：client.src.js 模板与
    // lib/parts/ 片段（方案 B 子文件拼接，拼接进 factory 作用域后互相引用，
    // no-undef/no-unused-vars 关闭）。构建产物 client.js 已在 ignores 排除。
    // 尺寸规则（复杂度/行数）照常强制。
    files: ['plugins/**/lib/client.src.js', 'plugins/**/lib/parts/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, __ModuleLoader__: 'readonly' },
    },
    plugins: { import: importPlugin },
    settings: importSettings,
    rules: {
      ...js.configs.recommended.rules,
      complexity: ['error', 10],
      'max-lines': ['error', 400],
      'max-lines-per-function': ['error', 70],
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // client 端：require 的模块必须存在。react / react-dom 与官方 UI 组件库
      // @deepseek-ai/dsh-client-ui-primitives 由 DSH 运行时注入（staticModules
      // 静态模块表，node_modules 无对应包，见 docs/开发指南/官方UI组件库.md），
      // ignore 豁免；dsh-* 跨插件模块经 moduleDirectory: plugins/ 映射到仓库内
      // 真实检查（require 不存在的 dsh-* 包 → lint 报错）
      'import/no-unresolved': [
        'error',
        { commonjs: true, ignore: ['^react$', '^react-dom(/.*)?$', '^@deepseek-ai/dsh-client-ui-primitives$'] },
      ],
    },
  },
  {
    // 测试文件：Node 环境，不套用行数/复杂度门禁（测试可长，保持可读）；
    // 下划线前缀参数（mock 接口占位）与 catch 绑定（`catch (err) {}`）豁免
    files: ['plugins/**/test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: { import: importPlugin },
    settings: importSettings,
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'import/no-unresolved': ['error', { commonjs: true }],
    },
  },
]
