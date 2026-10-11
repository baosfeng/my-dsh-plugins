/**
 * dsh-md-render — 路由路径**单一真源**（host 半与 client 半共用）。
 *
 * host 半的 `src/routes/config.ts` / `src/routes/assets.ts` 直接 import 本文件的常量；
 * client 半是 `__ModuleLoader__` 片段（不能 import host 代码），由 `scripts/build.mjs` 在构建期
 * 调用 `clientRouteDeclarations()` 把**同一批常量**注入到 `lib/client.src.js` 的
 * `__ROUTE_PATHS__` 占位符处 —— 因此两侧路径不可能各写一份而漂移
 * （防回归测试见 test/route-single-source.mjs）。
 *
 * 本文件编译为 lib/routes/paths.js（产物必须提交，CI 只跑产物、不跑构建）。
 */

/** 配置 API 前缀（client 侧派生出其下的 config 端点）。 */
export const CONFIG_API_PREFIX = '/md-render/api'

/** 静态资源前缀（client 侧派生出引擎 URL）。 */
export const ASSETS_PREFIX = '/md-render/assets'

/** 引擎文件名（host 读 assets/ 下同名文件；client fetch 同一名字）。 */
export const MERMAID_ENGINE_FILE = 'mermaid-10.9.3.min.js'

/** 语言索引查询端点（host 半按消息 markdown 建「内容哈希 → 语言」索引，client 半查表，issue #466）。 */
export const LANGS_API_URL = CONFIG_API_PREFIX + '/langs'

/** 语言索引查询的参数名（client 半派生 URL 时共用，避免两侧各写一个字面量）。 */
export const LANGS_HASH_PARAM = 'h'

/** panzoom 文件名（图表缩放 / 平移的 vendored 库；同引擎一样走 assets 懒加载，不进 client.js）。 */
export const PANZOOM_FILE = 'panzoom-4.6.2.min.js'

/** markdown 解析器文件名（自研渲染器的解析层；vendored UMD，走 assets 懒加载）。 */
export const MARKED_FILE = 'marked-18.1.0.umd.js'

/** 语法高亮库文件名（自研代码块渲染器的高亮层；vendored UMD，走 assets 懒加载）。 */
export const HIGHLIGHTJS_FILE = 'highlightjs-11.12.0.min.js'

/** client 半派生出的 URL（唯一路径拼接处，host / client 共用同一表达式）。 */
export const CONFIG_API_URL = CONFIG_API_PREFIX + '/config'
export const MERMAID_ENGINE_URL = ASSETS_PREFIX + '/' + MERMAID_ENGINE_FILE
export const PANZOOM_SCRIPT_URL = ASSETS_PREFIX + '/' + PANZOOM_FILE
export const MARKED_URL = ASSETS_PREFIX + '/' + MARKED_FILE
export const HIGHLIGHTJS_URL = ASSETS_PREFIX + '/' + HIGHLIGHTJS_FILE

/**
 * 生成注入 client 产物的声明文本（`scripts/build.mjs` 调用）。
 * 用 JSON.stringify 转义，避免路径里的特殊字符破坏产物语法。
 */
export function clientRouteDeclarations(): string {
  return [
    '// ── 路由路径（构建期由 host 半 lib/routes/paths.js 注入的单一真源）──────',
    'const CONFIG_API_URL = ' + JSON.stringify(CONFIG_API_URL),
    'const MERMAID_ENGINE_URL = ' + JSON.stringify(MERMAID_ENGINE_URL),
    'const PANZOOM_SCRIPT_URL = ' + JSON.stringify(PANZOOM_SCRIPT_URL),
    'const MARKED_URL = ' + JSON.stringify(MARKED_URL),
    'const HIGHLIGHTJS_URL = ' + JSON.stringify(HIGHLIGHTJS_URL),
    'const LANGS_API_URL = ' + JSON.stringify(LANGS_API_URL),
    'const LANGS_HASH_PARAM = ' + JSON.stringify(LANGS_HASH_PARAM),
  ].join('\n')
}
