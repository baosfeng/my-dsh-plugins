/**
 * dsh-mermaid-render — host half（TypeScript 源码）。
 *
 * 插件由两半组成：
 *  1. **client 半**（\`lib/client.js\`，\`__ModuleLoader__\` bundle）：把对话里的
 *     mermaid/mmd 代码块渲染为图表卡片（预览/代码切换、导出、失败兜底）；
 *  2. **host 半**（本文件）：注册 system-prompt section（issue #194）+ 静态文件
 *     路由（mermaid 引擎按需加载，替代 4.3MB base64 内联）。
 *
 * 默认注入；\`config.injectPrompt = false\` 时不注册 prompt section（client 渲染不受影响）。
 * 本文件编译为 lib/index.js（产物必须提交，CI 只跑产物、不跑构建）。
 */
import { readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPromptSection } from './prompt.js'
import type { PromptConfig } from './prompt.js'
import type { DshContext } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MERMAID_ASSET_PATH = join(__dirname, '..', 'assets', 'mermaid-10.9.3.min.js')
const MERMAID_ROUTE_PATH = '/mermaid-render/assets/mermaid-10.9.3.min.js'

export const name = 'dsh-mermaid-render'

/** 服务依赖：systemPrompt（硬）+ webServer（可选，静态文件路由）。 */
export const inject = ['systemPrompt'] as const

/** 插件配置（issue #194）。 */
export type MermaidRenderConfig = PromptConfig

/** Serve the mermaid engine as a static asset (replaces 4.3MB base64 inline). */
function createMermaidAssetHandler() {
  let cache: { etag: string; body: Buffer; mtime: string } | null = null

  return async function handleAsset(req: unknown, res: unknown) {
    const r = req as { url?: string; method?: string; headers?: Record<string, string | string[] | undefined> }
    const s = res as {
      writeHead: (code: number, headers?: Record<string, string>) => void
      end: (body?: Buffer | string) => void
    }
    // Only serve GET/HEAD
    if (r.method && r.method !== 'GET' && r.method !== 'HEAD') {
      s.writeHead(405)
      s.end()
      return
    }

    // Cache the file content (mermaid engine is ~3.3MB, read once)
    if (!cache) {
      try {
        const body = readFileSync(MERMAID_ASSET_PATH)
        const stat = statSync(MERMAID_ASSET_PATH)
        cache = { etag: `"${stat.size}-${stat.mtimeMs}"`, body, mtime: stat.mtime.toUTCString() }
      } catch {
        s.writeHead(404, { 'Content-Type': 'text/plain' })
        s.end('mermaid engine not found: run npm run build')
        return
      }
    }

    // ETag conditional (304 Not Modified)
    const ifNoneMatch = r.headers?.['if-none-match']
    if (ifNoneMatch === cache.etag) {
      s.writeHead(304)
      s.end()
      return
    }

    s.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Content-Length': String(cache.body.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: cache.etag,
      'Last-Modified': cache.mtime,
    })
    s.end(cache.body)
  }
}

export function apply(ctx: DshContext, config?: MermaidRenderConfig): void {
  // Register static asset route for mermaid engine (lazy-loaded by client)
  ctx.effect(
    () =>
      ctx.webServer?.register({
        kind: 'prefix',
        path: '/mermaid-render/assets',
        handler: createMermaidAssetHandler(),
      }),
    'dsh-mermaid-render: /mermaid-render/assets static route',
  )

  const section = createPromptSection(config)
  if (section === null) {
    ctx.logger?.info('[dsh-mermaid-render] 已挂载（client 端 mermaid 渲染；系统提示词注入已关闭）')
    return
  }
  ctx.systemPrompt?.section(section)
  ctx.logger?.info('[dsh-mermaid-render] 已挂载（client 端 mermaid 渲染 + 系统提示词能力说明注入）')
}
