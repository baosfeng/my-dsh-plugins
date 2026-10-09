/**
 * dsh-md-render — `/md-render/assets` 静态资源路由（mermaid 引擎）。
 *
 * 引擎**不内联**进 client bundle（issue #185 的 4.48 MB base64 冗余教训）：
 * `assets/mermaid-10.9.3.min.js`（3.34 MB）由 webServer 静态托管，client 首次渲染时
 * fetch 并按需注入 `<script>`。缓存 / ETag / 304 / 405 语义与合并前的
 * dsh-mermaid-render 完全一致，只是前缀搬到本插件命名空间。
 *
 * 本文件编译为 lib/routes/assets.js（产物必须提交）。
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ASSETS_PREFIX, MERMAID_ENGINE_FILE } from './paths.js'
import type { DshContext, ServerRequest, ServerResponse } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** 引擎路径：lib/routes/ → 包根 → assets/。 */
const MERMAID_ASSET_PATH = join(__dirname, '..', '..', 'assets', MERMAID_ENGINE_FILE)

/** 静态资源前缀来自单一真源 `src/routes/paths.ts`（同 config 路由）。 */
export { ASSETS_PREFIX }

/** 已注册资源的 disposer（按常驻 root 去重，与配置路由同款）。 */
const assetDisposers = new WeakMap<object, () => void>()

/** 引擎缓存条目（读一次；3.34 MB 文件不做每次请求的磁盘 IO）。 */
interface EngineCache {
  etag: string
  body: Buffer
  mtime: string
}

/** 注册静态资源路由（挂常驻 root + 去重，理由同 routes/config.ts）。 */
export function registerAssetRoutes(ctx: DshContext): void {
  const target = ((ctx as { root?: DshContext }).root ?? ctx) as DshContext
  if (assetDisposers.has(target as object)) return
  assetDisposers.set(
    target as object,
    target.effect(
      () =>
        target.webServer?.register({
          kind: 'prefix',
          path: ASSETS_PREFIX,
          handler: createAssetHandler(),
        }),
      'dsh-md-render: /md-render/assets static route',
    ) as unknown as () => void,
  )
}

/** 构造静态资源 handler（读一次 + 缓存；失败降级 404 而不是抛错）。 */
export function createAssetHandler(): (request: ServerRequest, response: ServerResponse) => Promise<void> {
  let cache: EngineCache | null = null
  return async (request, response) => {
    if (request.method && request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405)
      response.end()
      return
    }
    const loaded = cache ?? loadEngine(response)
    if (loaded === null) return
    cache = loaded
    if (request.headers['if-none-match'] === loaded.etag) {
      response.writeHead(304)
      response.end()
      return
    }
    response.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Content-Length': String(loaded.body.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: loaded.etag,
      'Last-Modified': loaded.mtime,
    })
    response.end(loaded.body)
  }
}

/** 读引擎文件并构造缓存条目；读不到 → 404（返回 null）。 */
function loadEngine(response: ServerResponse): EngineCache | null {
  try {
    const body = readFileSync(MERMAID_ASSET_PATH)
    const stat = statSync(MERMAID_ASSET_PATH)
    return { etag: `"${stat.size}-${stat.mtimeMs}"`, body, mtime: stat.mtime.toUTCString() }
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('mermaid engine not found: run npm run build')
    return null
  }
}
