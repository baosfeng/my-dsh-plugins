// ── markdown 图片「点击放大」灯箱（原生 <dialog> 模态）──────────────────────
// 用户反馈：图片只能静态看、点不开 —— 成熟方案（medium-zoom / PhotoSwipe /
// lightGallery）都支持点击放大。这里只借这条交互，实现用**原生 <dialog> +
// showModal()**（与本插件 mermaid 浮窗同款做法：零依赖，遮罩 / Esc / 焦点归还
// 由浏览器兜底），不引入任何三方库。
//
// 三路关闭：Esc（dialog 的 cancel 事件）/ 点击遮罩（点击落在 dialog 自身 =
// 点了 ::backdrop）/ 点击图片（想立刻收起时不必去够边缘）。关闭即把 dialog 从
// 文档移除（不留残留节点）；同一时刻只保留一个灯箱（再点第二张图先收掉上一个）。
//
// 安全口径与 markdown 渲染完全一致：src 仍过 mdSafeImageSrc（只放行 http / https
// 与同源相对路径），未放行的地址**不打开灯箱**；全程只有 DOM API（className /
// src / alt 属性赋值），没有 innerHTML / dangerouslySetInnerHTML。

/** 灯箱 <dialog> 类名。 */
const LIGHTBOX_CLASS = 'dsh-md-render-img-lightbox'
/** 灯箱内大图类名。 */
const LIGHTBOX_IMG_CLASS = 'dsh-md-render-img-lightbox-img'

/** 当前打开的灯箱（同一时刻只允许一个）。 */
let imageLightbox: HTMLDialogElement | null = null

/** 关闭灯箱（幂等；Esc / 遮罩 / 点击图片三路共用）。 */
function closeImageLightbox(): void {
  const dialog = imageLightbox
  if (dialog === null) return
  imageLightbox = null
  try {
    dialog.close()
  } catch (_e) {
    /* 已关闭 / 伪 DOM 无此方法 */
  }
  const parent = dialog.parentNode
  if (parent !== null && parent !== undefined) parent.removeChild(dialog)
}

/** 以模态方式打开（无 showModal 的环境退回 open 属性 —— 绝不静默失败）。 */
function showLightboxModal(dialog: HTMLDialogElement): void {
  try {
    dialog.showModal()
  } catch (_e) {
    dialog.open = true
  }
}

/** 点图放大；地址不在安全口径内 → 什么都不做（不加载来路不明的资源）。 */
function openImageLightbox(src: string, alt: string): void {
  const safe = mdSafeImageSrc(src)
  if (safe === '' || typeof document === 'undefined' || document === null) return
  closeImageLightbox()
  const dialog = document.createElement('dialog')
  dialog.className = LIGHTBOX_CLASS
  const img = document.createElement('img')
  img.className = LIGHTBOX_IMG_CLASS
  img.src = safe
  img.alt = alt
  dialog.appendChild(img)
  // ::backdrop 不是元素：点击落在 dialog 自身 = 点了遮罩；点图片同样收起。
  dialog.addEventListener('click', (event: Event) => {
    if (event.target === dialog || event.target === img) closeImageLightbox()
  })
  dialog.addEventListener('cancel', closeImageLightbox)
  document.body.appendChild(dialog)
  imageLightbox = dialog
  showLightboxModal(dialog)
}

exports.LIGHTBOX_CLASS = LIGHTBOX_CLASS
exports.LIGHTBOX_IMG_CLASS = LIGHTBOX_IMG_CLASS
exports.openImageLightbox = openImageLightbox
exports.closeImageLightbox = closeImageLightbox
