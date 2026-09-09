export const name = 'dsh-mermaid-render'
export function apply(ctx) {
  // client-only plugin: no host-side services, events, or routes.
  ctx.logger?.info('[dsh-mermaid-render] client-only 插件已挂载（mermaid 渲染在 client 端）')
}
