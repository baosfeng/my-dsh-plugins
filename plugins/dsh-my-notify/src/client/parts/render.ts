// ── 通知内容构造 ────────────────────────────────────────────────────
function shortId(id: string): string {
  if (typeof id !== 'string' || id === '') return ''
  return id.length > 8 ? id.slice(0, 8) : id
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'end':
      return strings.kindEnd()
    case 'ask':
      return strings.kindAsk()
    case 'approval':
      return strings.kindApproval()
    default:
      return strings.kindRemote()
  }
}

function noticeTitle(notice: NotifyNotice): string {
  if (typeof notice.title === 'string' && notice.title !== '') return notice.title
  return strings.untitled(shortId(notice.sessionId))
}

function noticeBody(notice: NotifyNotice): string {
  const parts = []
  if (notice.kind !== 'remote') parts.push(kindLabel(notice.kind))
  if (typeof notice.toolName === 'string' && notice.toolName !== '') parts.push(notice.toolName)
  if (typeof notice.note === 'string' && notice.note !== '') parts.push(notice.note)
  return parts.join(' · ')
}

function faviconOf(): string {
  try {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    return link !== null && typeof link.href === 'string' ? link.href : ''
  } catch {
    return ''
  }
}

// ── 页面内 toast（通知权限关闭/被拒时的兜底）────────────────────────
/** 共享图标是 React 元素树（icon.* 返回 createElement 树），toast 是命令式
 *  DOM 构建：把元素树转成 SVG DOM 节点复用同一套图标（stroke=currentColor
 *  继承周围文字色）。camelCase 属性转 SVG 属性名（viewBox 特例保持原样）。 */
function svgAttrName(key: string): string {
  if (key === 'viewBox') return 'viewBox'
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

function isVoidNode(node: unknown): boolean {
  return node === null || node === undefined || typeof node === 'boolean'
}

function isTextNode(node: unknown): boolean {
  return typeof node === 'string' || typeof node === 'number'
}

function toChildList(children: unknown): unknown[] {
  if (Array.isArray(children)) return children
  if (children === undefined || children === null) return []
  return [children]
}

function elementToDom(node: any): any {
  if (isVoidNode(node)) return null
  if (isTextNode(node)) return document.createTextNode(String(node))
  const el = document.createElementNS('http://www.w3.org/2000/svg', node.type)
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (key === 'children') continue
    el.setAttribute(svgAttrName(key), String(value))
  }
  for (const child of toChildList(node.props?.children)) {
    const dom = elementToDom(child)
    if (dom !== null) el.appendChild(dom)
  }
  return el
}

/** 通知类型 → 共享图标（stroke=currentColor，颜色语义由 CSS 类区分）。 */
function kindIcon(kind: string): any {
  switch (kind) {
    case 'end':
      return icon.clock(16)
    case 'ask':
      return icon.help(16)
    case 'approval':
      return icon.check(16)
    default:
      return icon.external(16)
  }
}

/** 通知类型 → 图标颜色语义类（end/remote=品牌色信息、ask=警告、approval=成功）。 */
function kindIconClass(kind: string): string {
  switch (kind) {
    case 'end':
      return 'dsh-my-notify-toast-icon-end'
    case 'ask':
      return 'dsh-my-notify-toast-icon-ask'
    case 'approval':
      return 'dsh-my-notify-toast-icon-approval'
    default:
      return 'dsh-my-notify-toast-icon-remote'
  }
}

// ── 系统通知（Notification API）────────────────────────────────────
function fireSystemNotification(notice: NotifyNotice, sessionId: string, openSession: () => void): void {
  try {
    const bodyText = noticeBody(notice)
    // 常驻通知：面板 config.system.requireInteraction 真正透传给 Notification
    // （浏览器未授权常驻时该选项被忽略，自动降级为普通通知）
    const notification = new Notification(noticeTitle(notice), {
      body: bodyText !== '' ? bodyText : kindLabel(notice.kind),
      tag: `dsh-my-notify:${notice.kind}:${sessionId}`,
      icon: faviconOf(),
      requireInteraction: systemConfigNow().requireInteraction === true,
    })
    notification.onclick = () => {
      try {
        notification.close()
      } catch {
        // ignore
        void 0
      }
      openSession()
    }
  } catch {
    // Notification constructor failure: fall back to the toast.
    showToast(notice, openSession)
  }
}

// ── 样式（DSH 语义 token，随 activation 注入）───────────────────────
const STYLES: string = `
.dsh-my-notify-toast-box{position:fixed;right:16px;bottom:16px;z-index:3000;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.dsh-my-notify-toast-box[data-pos="bottom-left"]{right:auto;left:16px;bottom:16px;top:auto}
.dsh-my-notify-toast-box[data-pos="top-right"]{right:16px;left:auto;top:16px;bottom:auto;flex-direction:column-reverse}
.dsh-my-notify-toast-box[data-pos="top-left"]{right:auto;left:16px;top:16px;bottom:auto;flex-direction:column-reverse}
.dsh-my-notify-toast-box[data-pos="top"]{right:auto;left:50%;top:16px;bottom:auto;transform:translateX(-50%);flex-direction:column-reverse}
.dsh-my-notify-toast-box[data-pos="bottom"]{right:auto;left:50%;bottom:16px;top:auto;transform:translateX(-50%)}
.dsh-my-notify-toast{pointer-events:auto;width:284px;max-width:calc(100vw - 32px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:var(--dsw-shadow-lv2);padding:10px 12px;cursor:pointer;
  animation:dsh-my-notify-toast-in 160ms var(--ds-ease-in-out);display:flex;flex-direction:column;gap:6px;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),transform var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-notify-toast:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-notify-toast:active{transform:scale(.99)}
.dsh-my-notify-toast-head{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-my-notify-toast-icon{flex:none;display:flex;align-items:center}
.dsh-my-notify-toast-icon svg{display:block}
.dsh-my-notify-toast-icon-end{color:var(--dsw-alias-accent)}
.dsh-my-notify-toast-icon-ask{color:var(--dsw-alias-state-warn-primary)}
.dsh-my-notify-toast-icon-approval{color:var(--dsw-alias-state-success-primary)}
.dsh-my-notify-toast-icon-remote{color:var(--dsw-alias-accent)}
.dsh-my-notify-toast-title{flex:1;min-width:0;font:var(--dsw-font-s-strong-14);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-my-notify-toast-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;
  border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-notify-toast-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-toast-close svg{display:block}
.dsh-my-notify-toast-body{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.6;word-break:break-word}
.dsh-my-notify-toast-actions{display:flex;align-items:center;gap:6px;margin-top:2px}
.dsh-my-notify-toast-open{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:6px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);
  font:var(--dsw-font-xxs-12);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-notify-toast-open:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-accent)}
.dsh-my-notify-toast-open svg{display:block;flex:none}
.dsh-my-notify-toast-out{opacity:0;transform:translateY(6px);transition:opacity 150ms var(--ds-ease-in-out),transform 150ms var(--ds-ease-in-out)}
@keyframes dsh-my-notify-toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`

function injectStyles(): () => void {
  if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-my-notify', 'styles')
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style)
  }
}
