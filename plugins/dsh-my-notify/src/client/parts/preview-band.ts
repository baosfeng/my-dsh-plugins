// ── 五形态预览带（底部）：系统通知 / toast / 飞书 / 企微 / 钉钉 ─────────
//
// 改标题或正文五处同时变；飞书列若取渠道的独立卡片模板，头部标注
// 「独立模板 · 设计器控制」（避免和文案页的默认渲染混淆）。

const BAND_FORMS: string[] = ['sys', 'toast', 'feishu', 'wecom', 'ding']

/** 形态名称。 */
function bandFormLabel(form: string): string {
  if (form === 'sys') return strings.formSys()
  if (form === 'toast') return strings.formToast()
  if (form === 'feishu') return strings.formFeishu()
  if (form === 'wecom') return strings.formWecom()
  return strings.formDing()
}

/** 单列：标题 + 舞台（就绪渲染 / 否则给对应形态的空舞台）。 */
function bandColumn(props: { form: string; preview: PreviewResult | null; title: string }) {
  const html = props.preview !== null ? renderPreviewFrame(props.form, props.preview) : ''
  return createElement(
    'div',
    { className: 'dsh-my-notify-pcol' },
    createElement('div', { className: 'dsh-my-notify-pcol-hd' }, bandFormLabel(props.form)),
    createElement(
      'div',
      { className: 'dsh-my-notify-pstage' },
      html !== ''
        ? createElement('div', { dangerouslySetInnerHTML: { __html: html } })
        : createElement('span', { className: 'dsh-my-notify-status' }, props.title),
    ),
  )
}

/** 预览带（可折叠；未就绪时给加载 / 失败 + 重试）。 */
function PreviewBand(props: {
  preview: PreviewResult | null
  status: string
  notice: { text: string; retry: boolean; kind: string }
  attempt: number
  onRetry: () => void
  open: boolean
  onToggle: () => void
  feishuIndependent: boolean
  title: string
}) {
  return createElement(
    'section',
    { className: 'dsh-my-notify-band', 'data-open': String(props.open), 'aria-label': strings.bandTitle() },
    createElement(
      'div',
      { className: 'dsh-my-notify-band-hd' },
      createElement('b', { className: 'dsh-my-notify-label' }, strings.bandTitle()),
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.bandHint()),
      props.feishuIndependent
        ? createElement(
            'span',
            { className: 'dsh-my-notify-badge', 'data-kind': 'accent' },
            strings.bandFeishuIndependent(),
          )
        : null,
      createElement('span', { className: 'dsh-my-notify-grow' }),
      props.status !== 'ready'
        ? createElement(
            'span',
            { className: props.notice.kind === 'error' ? 'dsh-my-notify-error' : 'dsh-my-notify-status' },
            props.notice.text,
          )
        : null,
      props.notice.retry
        ? createElement(
            'button',
            { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onRetry },
            strings.previewRetry(),
          )
        : null,
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-notify-btn',
          'aria-expanded': String(props.open),
          onClick: props.onToggle,
        },
        props.open ? strings.bandCollapse() : strings.bandExpand(),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-band-cols' },
      BAND_FORMS.map((form) => bandColumn({ form, preview: props.preview, title: props.title })),
    ),
  )
}
