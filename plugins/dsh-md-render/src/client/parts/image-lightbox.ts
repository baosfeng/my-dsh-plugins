// ── 图片点击放大（B 路）：原生 <dialog> 模态灯箱 ──────────────────────────
// 交互：markdown 图片点击 → 原生 <dialog>.showModal()（遮罩 / Esc / 焦点归还 / 背景
// 滚动锁定由浏览器兜底，零依赖）；三路关闭 = Esc（cancel 事件）/ 点击遮罩 /
// 点击图片本身；同一时刻只保留一个灯箱（再点第二张先收掉上一个）。
//
// 安全口径：只放行 http(s) 与同源相对路径（与 markdown 渲染同一条口径），未放行的
// 地址**不打开灯箱**、不加载来路不明的资源；全程只有 DOM API，没有 innerHTML。

/** 灯箱 <dialog> / 内容包装 / 大图 / 关闭按钮类名。 */
const MDR_LIGHTBOX_CLASS = 'mdr-lightbox'
const MDR_LIGHTBOX_WRAP_CLASS = 'mdr-lightbox-wrap'
const MDR_LIGHTBOX_IMG_CLASS = 'mdr-lightbox-img'
const MDR_LIGHTBOX_CLOSE_CLASS = 'mdr-lightbox-close'
/** 宿主容器已绑定点击代理的标记。 */
const MDR_LIGHTBOX_BOUND_ATTR = 'data-mdr-lightbox-bound'

/** 当前打开的灯箱（同一时刻只允许一个）。 */
let mdrLightbox: HTMLDialogElement | null = null

/** 安全图片地址：http(s) 绝对地址或同源相对路径；其余（javascript: / data: 等）→ ''。 */
function mdrSafeImageSrc(url: unknown): string {
  const text = typeof url === 'string' ? url.trim() : ''
  if (text === '') return ''
  if (/^https?:\/\//i.test(text)) return text
  if (/^\/\//.test(text)) return text
  if (text.charAt(0) === '/' || text.indexOf('./') === 0 || text.indexOf('../') === 0) return text
  return ''
}

/** 关闭灯箱（幂等；Esc / 遮罩 / 点击图片三路共用）。 */
function closeImageLightbox(): void {
  const dialog = mdrLightbox
  if (dialog === null) return
  mdrLightbox = null
  try {
    dialog.close()
  } catch (_e) {
    /* 已关闭 / 伪 DOM 无此方法 */
  }
  if (dialog.parentNode) dialog.parentNode.removeChild(dialog)
}

/** 以模态方式打开（无 showModal 的环境退回 open 属性 —— 绝不静默失败）。 */
function showMdrLightbox(dialog: HTMLDialogElement): void {
  try {
    dialog.showModal()
  } catch (_e) {
    dialog.open = true
  }
}

/** 显式关闭按钮（右上角圆形；叉线由 CSS 的 ::before / ::after 画）。 */
function mdrLightboxCloseButton(): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = MDR_LIGHTBOX_CLOSE_CLASS
  button.type = 'button'
  button.setAttribute('aria-label', '关闭')
  button.textContent = '×'
  button.addEventListener('click', closeImageLightbox)
  return button
}

/** 点图放大；地址不在安全口径内 → 什么都不做。 */
function openImageLightbox(src: unknown, alt: unknown): void {
  const safe = mdrSafeImageSrc(src)
  if (safe === '' || typeof document === 'undefined' || document === null) return
  closeImageLightbox()
  const dialog = document.createElement('dialog') as HTMLDialogElement
  dialog.className = MDR_LIGHTBOX_CLASS
  const wrap = document.createElement('div')
  wrap.className = MDR_LIGHTBOX_WRAP_CLASS
  const img = document.createElement('img')
  img.className = MDR_LIGHTBOX_IMG_CLASS
  img.src = safe
  img.alt = typeof alt === 'string' ? alt : ''
  wrap.appendChild(img)
  wrap.appendChild(mdrLightboxCloseButton())
  dialog.appendChild(wrap)
  dialog.addEventListener('click', (event: Event) => {
    if (event.target === dialog || event.target === img) closeImageLightbox()
  })
  dialog.addEventListener('cancel', closeImageLightbox)
  document.body.appendChild(dialog)
  mdrLightbox = dialog
  showMdrLightbox(dialog)
}

/** 事件目标最近的 <img>（选择器不成立 / 抛错 → null）。 */
function mdrClosestImage(target: unknown): Element | null {
  const el = target as { closest?: (selector: string) => unknown } | null
  if (el === null || el === undefined || typeof el.closest !== 'function') return null
  try {
    const img = el.closest('img')
    return img === null || img === undefined ? null : (img as Element)
  } catch (_e) {
    return null
  }
}

/** 点击代理：host 内的 <img> 被点击 → 放大（绕开按钮 / 链接内的图片）。 */
function mdrImageFromEvent(host: Element, target: unknown): Element | null {
  const element = mdrClosestImage(target)
  if (element === null) return null
  if (typeof host.contains === 'function' && !host.contains(element)) return null
  if (typeof element.closest === 'function' && element.closest('button,a')) return null
  return element
}

/**
 * 给宿主容器挂一次点击放大（契约导出）：同一容器重复调用是幂等的；
 * 事件代理 → 后插入的图片也自动生效，不需要逐图绑定。
 */
function mountMdrLightbox(host: Element): void {
  if (!host || typeof host.addEventListener !== 'function' || typeof host.getAttribute !== 'function') return
  if (host.getAttribute(MDR_LIGHTBOX_BOUND_ATTR) === 'true') return
  host.setAttribute(MDR_LIGHTBOX_BOUND_ATTR, 'true')
  host.addEventListener('click', (event: Event) => {
    const img = mdrImageFromEvent(host, event.target)
    if (img === null) return
    openImageLightbox(img.getAttribute('src'), img.getAttribute('alt'))
  })
}

exports.MDR_LIGHTBOX_CLASS = MDR_LIGHTBOX_CLASS
exports.MDR_LIGHTBOX_BOUND_ATTR = MDR_LIGHTBOX_BOUND_ATTR
exports.mdrSafeImageSrc = mdrSafeImageSrc
exports.openImageLightbox = openImageLightbox
exports.closeImageLightbox = closeImageLightbox
exports.mountMdrLightbox = mountMdrLightbox
