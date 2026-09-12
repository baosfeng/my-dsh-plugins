/**
 * dsh-mermaid-render — client half (browser). SOURCE TEMPLATE.
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs
 * 先运行 `tsc -p tsconfig.client.json` 把 src/client/index.ts 编译成
 * CommonJS 单文件（lib/.client-build/index.js），再注入下方
 * /*__CLIENT_BUNDLE__* / 占位符（函数式 replaceAll，避免 $&/$1 特殊解释），
 * 写出 lib/client.js —— 即 DSH 实际服务的产物（单一 __ModuleLoader__ bundle）。
 * 产物必须提交；CI 只对产物执行 node --check（见 .github/workflows/ci.yml）。
 *
 * 编译产物为 CommonJS 格式：require / exports / module 均为本 factory 作用域
 * 变量（require 由 __ModuleLoader__ 注入，exports/module 为上方局部变量），
 * 因此产物可直接内联。client 端 TS 源码为单文件（无运行时相对 import），
 * 需要多文件/复杂打包时可用 esbuild/tsdown（官方 tsdown.client.ts 协议）。
 */
// 引擎载荷的占位符只由 src/client/index.ts 的编译产物承载（位于其字符串字面量内，
// 注入必须**恰好一处**，
// 见 scripts/splice.mjs）：本文件任何位置（含注释）都不要写出与它同形的字面量，
// 否则构建会因"placeholder 不止一处"显式失败 —— 这正是 issue #185 的成因
// （模板注释与产物占位符同形 → 4.45 MB base64 被注入两遍 → 产物/包体积翻倍）。
window.__ModuleLoader__.load({
  id: 'dsh-mermaid-render',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // ── TS 编译产物（scripts/build.mjs 注入）────────────────────────
    /*__CLIENT_BUNDLE__*/

    return module.exports
  },
})
