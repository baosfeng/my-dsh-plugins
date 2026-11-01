'use strict'
function EventList(props) {
  return createElement(
    'nav',
    { className: 'dsh-my-notify-col dsh-my-notify-col-evlist', 'aria-label': strings.copyEvent() },
    createElement('div', { className: 'dsh-my-notify-col-hd' }, strings.evTemplates()),
    createElement(
      'div',
      { className: 'dsh-my-notify-evlist', role: 'tablist', 'aria-label': strings.copyEvent() },
      EVENT_KEYS.map((key) =>
        createElement(
          'button',
          {
            key,
            type: 'button',
            className: 'dsh-my-notify-evbtn',
            role: 'tab',
            'aria-current': String(key === props.active),
            onClick: () => props.onPick(key),
          },
          createElement('span', { className: 'dsh-my-notify-evd', 'data-kind': eventDotOf(key) }),
          createElement(
            'span',
            null,
            createElement('span', { className: 'dsh-my-notify-evname' }, eventLabelOf(key)),
            createElement(
              'span',
              { className: 'dsh-my-notify-evmeta' },
              props.enabledOf(key) ? strings.eventEnabled() : strings.eventDisabled(),
            ),
          ),
        ),
      ),
    ),
  )
}
function EventSelect(props) {
  return createElement(
    'select',
    {
      className: 'dsh-my-notify-evselect',
      value: props.active,
      'aria-label': strings.copyEvent(),
      onChange: (event) => props.onPick(event.target.value),
    },
    EVENT_KEYS.map((key) => createElement('option', { key, value: key }, eventLabelOf(key))),
  )
}
