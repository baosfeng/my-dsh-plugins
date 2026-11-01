'use strict'
const BAND_FORMS = ['sys', 'toast', 'feishu', 'wecom', 'ding']
function bandFormLabel(form) {
  if (form === 'sys') return strings.formSys()
  if (form === 'toast') return strings.formToast()
  if (form === 'feishu') return strings.formFeishu()
  if (form === 'wecom') return strings.formWecom()
  return strings.formDing()
}
function bandColumn(props) {
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
function PreviewBand(props) {
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
