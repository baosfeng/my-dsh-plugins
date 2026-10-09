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
export const CONFIG_API_PREFIX = '/md-render/api';
/** 静态资源前缀（client 侧派生出引擎 URL）。 */
export const ASSETS_PREFIX = '/md-render/assets';
/** 引擎文件名（host 读 assets/ 下同名文件；client fetch 同一名字）。 */
export const MERMAID_ENGINE_FILE = 'mermaid-10.9.3.min.js';
/** client 半派生出的两个 URL（唯一路径拼接处，host / client 共用同一表达式）。 */
export const CONFIG_API_URL = CONFIG_API_PREFIX + '/config';
export const MERMAID_ENGINE_URL = ASSETS_PREFIX + '/' + MERMAID_ENGINE_FILE;
/**
 * 生成注入 client 产物的声明文本（`scripts/build.mjs` 调用）。
 * 用 JSON.stringify 转义，避免路径里的特殊字符破坏产物语法。
 */
export function clientRouteDeclarations() {
    return [
        '// ── 路由路径（构建期由 host 半 lib/routes/paths.js 注入的单一真源）──────',
        'const CONFIG_API_URL = ' + JSON.stringify(CONFIG_API_URL),
        'const MERMAID_ENGINE_URL = ' + JSON.stringify(MERMAID_ENGINE_URL),
    ].join('\n');
}
