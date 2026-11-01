'use strict'
function ensureToastBox() {
  let box = document.getElementById('dsh-my-notify-toast-box')
  if (box === null) {
    box = document.createElement('div')
    box.id = 'dsh-my-notify-toast-box'
    box.className = 'dsh-my-notify-toast-box'
    document.body.appendChild(box)
  }
  const config = toastConfigNow()
  box.setAttribute('data-pos', config.position)
  return box
}
function buildToastItem(notice) {
  const item = document.createElement('div')
  item.className = 'dsh-my-notify-toast'
  item.setAttribute('role', 'status')
  const head = document.createElement('div')
  head.className = 'dsh-my-notify-toast-head'
  const iconWrap = document.createElement('span')
  iconWrap.className = `dsh-my-notify-toast-icon ${kindIconClass(notice.kind)}`
  iconWrap.appendChild(elementToDom(kindIcon(notice.kind)))
  head.appendChild(iconWrap)
  const title = document.createElement('span')
  title.className = 'dsh-my-notify-toast-title'
  title.textContent = noticeTitle(notice)
  head.appendChild(title)
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'dsh-my-notify-toast-close'
  closeBtn.setAttribute('aria-label', strings.closeToast())
  closeBtn.appendChild(elementToDom(icon.close(15)))
  head.appendChild(closeBtn)
  item.appendChild(head)
  const body = document.createElement('div')
  body.className = 'dsh-my-notify-toast-body'
  const bodyText =
    (typeof notice.note === 'string' && notice.note !== '' ? notice.note : noticeBody(notice)) || kindLabel(notice.kind)
  body.textContent = bodyText
  item.appendChild(body)
  const actions = document.createElement('div')
  actions.className = 'dsh-my-notify-toast-actions'
  const openBtn = document.createElement('button')
  openBtn.type = 'button'
  openBtn.className = 'dsh-my-notify-toast-open'
  openBtn.appendChild(elementToDom(icon.external(14)))
  const openLabel = document.createElement('span')
  openLabel.textContent = strings.openSession()
  openBtn.appendChild(openLabel)
  actions.appendChild(openBtn)
  item.appendChild(actions)
  return item
}
function attachToastEvents(item, onOpen, durationMs) {
  const duration = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 4000
  let timer = null
  const dismiss = () => {
    if (timer !== null) clearTimeout(timer)
    if (item.parentNode === null) return
    item.classList.add('dsh-my-notify-toast-out')
    setTimeout(() => {
      if (item.parentNode !== null) item.parentNode.removeChild(item)
    }, 150)
  }
  item.addEventListener('click', (event) => {
    if (event !== null && event.stopPropagation) event.stopPropagation()
    dismiss()
    try {
      onOpen()
    } catch {
      void 0
    }
  })
  const closeBtn = item.querySelector('.dsh-my-notify-toast-close')
  if (closeBtn !== null) {
    closeBtn.addEventListener('click', (event) => {
      if (event !== null && event.stopPropagation) event.stopPropagation()
      if (event !== null && event.preventDefault) event.preventDefault()
      dismiss()
    })
  }
  const openBtn = item.querySelector('.dsh-my-notify-toast-open')
  if (openBtn !== null) {
    openBtn.addEventListener('click', (event) => {
      if (event !== null && event.stopPropagation) event.stopPropagation()
      if (event !== null && event.preventDefault) event.preventDefault()
      dismiss()
      try {
        onOpen()
      } catch {
        void 0
      }
    })
  }
  timer = setTimeout(dismiss, duration)
}
function showToast(notice, onOpen) {
  if (typeof document === 'undefined') return
  loadRuntimeConfig()
  const config = toastConfigNow()
  if (!prefOn(LS.toast, true)) return
  if (config.enabled === false) return
  const box = ensureToastBox()
  const item = buildToastItem(notice)
  attachToastEvents(item, onOpen, config.durationMs)
  box.appendChild(item)
  let guard = 0
  while (box.children.length > config.maxStack && box.children.length > 0 && guard < 20) {
    box.removeChild(box.firstChild)
    guard += 1
  }
}
function removeToastBox() {
  try {
    const box = document.getElementById('dsh-my-notify-toast-box')
    if (box !== null && box.parentNode !== null) box.parentNode.removeChild(box)
  } catch {
    void 0
  }
}
