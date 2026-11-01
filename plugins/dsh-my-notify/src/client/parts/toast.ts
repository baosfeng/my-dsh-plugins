function ensureToastBox(): HTMLElement {
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

function buildToastItem(notice: NotifyNotice): HTMLElement {
  const item = document.createElement('div')
  item.className = 'dsh-my-notify-toast'
  item.setAttribute('role', 'status')
  const head = document.createElement('div')
  head.className = 'dsh-my-notify-toast-head'
  // 类型图标：共享图标 + 颜色语义（end=clock/品牌色、ask=help/警告、
  // approval=check/成功、remote=external/品牌色）。
  const iconWrap = document.createElement('span')
  iconWrap.className = `dsh-my-notify-toast-icon ${kindIconClass(notice.kind)}`
  iconWrap.appendChild(elementToDom(kindIcon(notice.kind)))
  head.appendChild(iconWrap)
  const title = document.createElement('span')
  title.className = 'dsh-my-notify-toast-title'
  title.textContent = noticeTitle(notice)
  head.appendChild(title)
  // 关闭按钮：close 图标按钮（纯图标，aria-label 无障碍）。
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'dsh-my-notify-toast-close'
  closeBtn.setAttribute('aria-label', strings.closeToast())
  closeBtn.appendChild(elementToDom(icon.close(15)))
  head.appendChild(closeBtn)
  item.appendChild(head)
  const body = document.createElement('div')
  body.className = 'dsh-my-notify-toast-body'
  // 正文直接用服务端渲染好的 note（模板已按事件渲染）；缺失时回退「类型 · 工具」摘要
  const bodyText =
    (typeof notice.note === 'string' && notice.note !== '' ? notice.note : noticeBody(notice)) || kindLabel(notice.kind)
  body.textContent = bodyText
  item.appendChild(body)
  // 操作按钮：打开会话（external 图标 + 文字，点击跳转会话）。
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
  // 只允许 textContent 渲染：note/远程 body 不受信任，禁止 innerHTML。
  return item
}

function attachToastEvents(item: HTMLElement, onOpen: () => void, durationMs?: number): void {
  const duration = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 4000
  let timer = null
  const dismiss = () => {
    if (timer !== null) clearTimeout(timer)
    if (item.parentNode === null) return
    // 退场动画：先播 150ms 过渡再移除节点。
    item.classList.add('dsh-my-notify-toast-out')
    setTimeout(() => {
      if (item.parentNode !== null) item.parentNode.removeChild(item)
    }, 150)
  }
  // toast 整体点击：关闭 + 跳转会话（保留原行为）。
  item.addEventListener('click', (event) => {
    if (event !== null && event.stopPropagation) event.stopPropagation()
    dismiss()
    try {
      onOpen()
    } catch {
      // opening the session is best-effort
      void 0
    }
  })
  // 关闭按钮：只关闭不跳转。
  const closeBtn = item.querySelector('.dsh-my-notify-toast-close')
  if (closeBtn !== null) {
    closeBtn.addEventListener('click', (event) => {
      if (event !== null && event.stopPropagation) event.stopPropagation()
      if (event !== null && event.preventDefault) event.preventDefault()
      dismiss()
    })
  }
  // 打开会话按钮：关闭 + 跳转（与整体点击一致，stopPropagation 防双重触发）。
  const openBtn = item.querySelector('.dsh-my-notify-toast-open')
  if (openBtn !== null) {
    openBtn.addEventListener('click', (event) => {
      if (event !== null && event.stopPropagation) event.stopPropagation()
      if (event !== null && event.preventDefault) event.preventDefault()
      dismiss()
      try {
        onOpen()
      } catch {
        // opening the session is best-effort
        void 0
      }
    })
  }
  timer = setTimeout(dismiss, duration)
}

function showToast(notice: NotifyNotice, onOpen: () => void): void {
  if (typeof document === 'undefined') return
  loadRuntimeConfig()
  const config = toastConfigNow()
  // 运行时 gate 统一读本地键（启动时已用服务端 toast.enabled 播种缺失键）
  if (!prefOn(LS.toast, true)) return
  if (config.enabled === false) return
  const box = ensureToastBox()
  const item = buildToastItem(notice)
  attachToastEvents(item, onOpen, config.durationMs)
  box.appendChild(item)
  // 堆叠上限：超出时移除最旧的一条（服务端 maxStack 1~10）
  let guard = 0
  while (box.children.length > config.maxStack && box.children.length > 0 && guard < 20) {
    box.removeChild(box.firstChild)
    guard += 1
  }
}

function removeToastBox(): void {
  try {
    const box = document.getElementById('dsh-my-notify-toast-box')
    if (box !== null && box.parentNode !== null) box.parentNode.removeChild(box)
  } catch {
    // ignore
    void 0
  }
}
