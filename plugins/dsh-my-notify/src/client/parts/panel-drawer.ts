/** 简版面板：更多设置抽屉（渠道 / 呈现 / 高级，复用既有分区组件）。 */

interface PanelDrawerProps {
  open: string | null
  onOpen: (tab: string) => void
  onClose: () => void
  draft: NotifyConfig
  patch: PatchFn
  volume: number
  onVolumeChange: (v: number) => void
  apiToken: string
  onTest: (kind: string, sample: string, done: (ok: boolean) => void) => void
}

/** 更多设置：右侧抽屉，三个分区。 */
function PanelDrawer(props: PanelDrawerProps) {
  useEffect(() => {
    if (props.open === null) return
    const onKey = (event: any): void => {
      if (event.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props.open])
  if (props.open === null) return null
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-drawer' },
    createElement('div', { className: 'dsh-my-notify-p-drawer-scrim', onClick: props.onClose }),
    createElement(
      'div',
      {
        className: 'dsh-my-notify-p-drawer-panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': strings.panelMoreTitle(),
        onClick: (event: any) => event.stopPropagation(),
      },
      panelDrawerHead(props),
      panelDrawerTabs(props),
      createElement('div', { className: 'dsh-my-notify-p-drawer-body' }, panelDrawerPane(props)),
    ),
  )
}

/** 抽屉头：标题 + 关闭。 */
function panelDrawerHead(props: PanelDrawerProps) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-drawer-head' },
    createElement('h2', { className: 'dsh-my-notify-p-drawer-title' }, strings.panelMoreTitle()),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-p-drawer-close', onClick: props.onClose },
      strings.panelClose(),
    ),
  )
}

/** 抽屉分区切换（渠道 / 呈现 / 高级）。 */
function panelDrawerTabs(props: PanelDrawerProps) {
  const tabs = [
    { value: 'channel', label: strings.paneChannel() },
    { value: 'present', label: strings.panePresent() },
    { value: 'secure', label: strings.paneSecure() },
  ]
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-drawer-tabs', role: 'tablist', 'aria-label': strings.panelMoreTitle() },
    tabs.map((tab) =>
      createElement(
        'button',
        {
          key: tab.value,
          type: 'button',
          className: 'dsh-my-notify-p-drawer-tab',
          role: 'tab',
          'aria-selected': String(props.open === tab.value),
          onClick: () => props.onOpen(tab.value),
        },
        tab.label,
      ),
    ),
  )
}

/** 当前分区内容（每个分区是独立组件，切换时整块挂载/卸载）。 */
function panelDrawerPane(props: PanelDrawerProps) {
  if (props.open === 'present') return createElement(PanelPresentPane, props)
  if (props.open === 'secure') return createElement(PanelSecurePane, props)
  return createElement(PanelChannelPane, props)
}

/** 渠道分区（复用渠道列表 + 编辑抽屉 + 卡片设计器）。 */
function PanelChannelPane(props: PanelDrawerProps) {
  return createElement(WebhookSection, {
    webhooks: props.draft.webhooks ?? [],
    apiToken: props.apiToken,
    onPatchWebhooks: (next: WebhookEntry[]) => props.patch('webhooks', next),
  })
}

/** 呈现分区（系统通知 / toast / 提示音 / 免打扰）。 */
function PanelPresentPane(props: PanelDrawerProps) {
  return renderPresentPane(props.draft, props.patch, props.volume, props.onVolumeChange)
}

/** 高级分区（token / 站点根 / 远程测试 / 导入导出）。 */
function PanelSecurePane(props: PanelDrawerProps) {
  return renderSecurePane(props.draft, props.patch, props.apiToken, props.onTest)
}
