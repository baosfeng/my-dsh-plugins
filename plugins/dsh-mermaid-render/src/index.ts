/**
 * dsh-mermaid-render — host half (empty shell).
 *
 * The plugin is client-only: it renders mermaid/mmd code blocks in the
 * conversation (see lib/client.js). This host half exists so the bundle row
 * mounts cleanly; nothing runs server-side.
 */
import type { DshContext } from './types.js'

export const name = 'dsh-mermaid-render'

export function apply(ctx: DshContext): void {
  // client-only plugin: no host-side services, events, or routes.
  ctx.logger?.info('[dsh-mermaid-render] client-only 插件已挂载（mermaid 渲染在 client 端）')
}
