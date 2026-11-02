'use strict'
function PanelDrawer(props) {
  useEffect(() => {
    if (props.open === null) return
    const onKey = (event) => {
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
        onClick: (event) => event.stopPropagation(),
      },
      panelDrawerHead(props),
      panelDrawerTabs(props),
      createElement('div', { className: 'dsh-my-notify-p-drawer-body' }, panelDrawerPane(props)),
    ),
  )
}
function panelDrawerHead(props) {
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
function panelDrawerTabs(props) {
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
function panelDrawerPane(props) {
  if (props.open === 'present') return createElement(PanelPresentPane, props)
  if (props.open === 'secure') return createElement(PanelSecurePane, props)
  return createElement(PanelChannelPane, props)
}
function PanelChannelPane(props) {
  return createElement(WebhookSection, {
    webhooks: props.draft.webhooks ?? [],
    apiToken: props.apiToken,
    onPatchWebhooks: (next) => props.patch('webhooks', next),
  })
}
function PanelPresentPane(props) {
  return renderPresentPane(props.draft, props.patch, props.volume, props.onVolumeChange)
}
function PanelSecurePane(props) {
  return renderSecurePane(props.draft, props.patch, props.apiToken, props.onTest)
}
