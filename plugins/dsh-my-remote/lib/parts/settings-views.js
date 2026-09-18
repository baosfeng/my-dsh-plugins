// ── 设置页通用视图片段（issue #385）───────────────────────────────────────
// 输入行 / 字段容器 / 加载失败视图。样式走宿主语义 token（--dsw-*），随 activation
// 注入、fiber teardown 卸载（HMR / 禁用无残留）。
//
// 本文件是 part 片段（构建期拼接进 __ModuleLoader__ factory 作用域），无 import/export。

/** 输入行（文本 / 数字 / 密码）。 */
function MyRemoteTextRow(props) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-row' },
    createElement(
      'div',
      { className: 'dsh-my-remote-info' },
      createElement('div', { className: 'dsh-my-remote-label' }, props.label),
      createElement('div', { className: 'dsh-my-remote-hint' }, props.hint),
    ),
    createElement('input', {
      className: 'dsh-my-remote-input',
      type: props.type ?? 'text',
      value: props.value,
      placeholder: props.placeholder ?? '',
      'aria-label': props.label,
      onChange: (event) => props.onChange(event.target.value),
    }),
  )
}

/** 字段容器（label + 控件）。 */
function myRemoteField(label, control) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-webhook-field' },
    createElement('div', { className: 'dsh-my-remote-webhook-field-label' }, label),
    control,
  )
}

/** 文本输入控件（webhook 编辑器内）。 */
function myRemoteInput(value, placeholder, onChange) {
  return createElement('input', {
    className: 'dsh-my-remote-webhook-input',
    value,
    placeholder,
    onChange: (event) => onChange(event.target.value),
  })
}

/** 加载失败视图：失败原因（http 状态 / 网络）+ 针对性提示 + 重试。 */
function MyRemoteLoadError(props) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-settings' },
    createElement('div', { className: 'dsh-my-remote-error' }, MY_REMOTE_STRINGS.loadFailed()),
    createElement('div', { className: 'dsh-my-remote-status' }, myRemoteErrorHint(props.errorKind)),
    createElement(
      'div',
      { className: 'dsh-my-remote-actions' },
      createElement(
        'button',
        { 'data-role': 'settings-retry', className: 'dsh-my-remote-btn', onClick: props.onRetry },
        MY_REMOTE_STRINGS.retry(),
      ),
    ),
  )
}
