/** 简版面板：飞书卡片实时预览 + 卡片颜色。 */

interface PanelPreviewProps {
  preview: PreviewResult | null
  status: string
  notice: { text: string; retry: boolean; kind: string }
  onRetry: () => void
  card: CardConfig
  hasChannel: boolean
  onPatchCard: (card: CardConfig) => void
}

/** 卡片当前显式主题色（空串 = 按事件自动）。 */
function panelCardTone(card: CardConfig): string {
  const tone = card !== null && card !== undefined && typeof card.template === 'string' ? card.template : ''
  return CARD_ACCENTS.some((option) => option.value === tone) ? tone : ''
}

/** 预览区：真实服务端卡片 JSON → HTML，改字即变。 */
function PanelPreview(props: PanelPreviewProps) {
  return createElement(
    'aside',
    { className: 'dsh-my-notify-p-preview', 'aria-label': strings.panelPreview() },
    createElement(
      'div',
      { className: 'dsh-my-notify-p-preview-head' },
      createElement('span', null, strings.panelPreview()),
      createElement('span', { className: 'dsh-my-notify-p-hint' }, strings.panelPreviewLive()),
    ),
    panelPreviewStage(props),
    panelCardColors(props),
    createElement(
      'p',
      { className: 'dsh-my-notify-p-card-hint' },
      props.hasChannel ? strings.panelCardHint() : strings.panelCardNoChannel(),
    ),
  )
}

/** 卡片舞台：ready 渲染 HTML；loading 骨架；error / idle 给一句提示。 */
function panelPreviewStage(props: PanelPreviewProps) {
  if (props.preview !== null && props.status === 'ready') {
    return createElement('div', {
      className: 'dsh-my-notify-p-card-stage',
      dangerouslySetInnerHTML: { __html: renderFeishuCardHtml(props.preview.card) },
    })
  }
  return [
    createElement(
      'div',
      { key: 'stage', className: 'dsh-my-notify-p-card-skeleton' },
      props.status === 'loading'
        ? strings.previewLoading()
        : props.status === 'idle'
          ? strings.panelPreviewEmpty()
          : strings.previewFailed(),
    ),
    props.notice.text !== '' && props.notice.kind !== 'status'
      ? createElement(
          'p',
          { key: 'notice', className: 'dsh-my-notify-p-preview-status', 'data-kind': props.notice.kind },
          props.notice.text,
          props.notice.retry
            ? createElement(
                'button',
                { type: 'button', className: 'dsh-my-notify-p-auto', onClick: props.onRetry },
                strings.previewRetry(),
              )
            : null,
        )
      : null,
  ]
}

/** 卡片颜色：4 个显式色 + 「自动」（按事件配色）。 */
function panelCardColors(props: PanelPreviewProps) {
  const active = props.hasChannel ? panelCardTone(props.card) : ''
  const disable = props.hasChannel ? undefined : true
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-dots' },
    createElement('span', null, strings.panelCardColor()),
    CARD_ACCENTS.map((option) =>
      createElement('button', {
        key: option.value,
        type: 'button',
        className: 'dsh-my-notify-p-dot',
        'data-tone': option.value,
        'aria-label': option.label(),
        'aria-pressed': String(active === option.value),
        disabled: disable,
        title: props.hasChannel ? option.label() : strings.panelCardNoChannel(),
        onClick: () => props.onPatchCard({ ...props.card, template: option.value }),
      }),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-notify-p-auto',
        'aria-pressed': String(active === ''),
        disabled: disable,
        title: props.hasChannel ? strings.panelCardAuto() : strings.panelCardNoChannel(),
        onClick: () => props.onPatchCard({ ...props.card, template: '', accentByKind: true }),
      },
      strings.panelCardAuto(),
    ),
  )
}
