// ── settings tab (replaces 迁移前的 settings.pluginToggles) ────
//
// The host renders no per-plugin toggle UI for third-party tabs, so this
// plugin contributes its own tab to the Web Settings → Plugins section
// ('settings.plugins.tab': a list seat declared by the settings section). The
// section only exists while it is mounted, so the seat is declared with
// ctx.slots.inject — the declarative form that survives HMR and late mounts
// (a plain register on a not-yet-mounted seat would silently contribute
// nothing).

/** Auto-open preference (plugin-owned; 迁移前的插件偏好已不存在). */
function autoOpenEnabled(): boolean {
  try {
    return window.localStorage.getItem(AUTO_OPEN_PREF_KEY) !== '0'
  } catch {
    return true
  }
}

/** Persist the auto-open preference. */
function setAutoOpenEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(AUTO_OPEN_PREF_KEY, enabled ? '1' : '0')
  } catch {
    // storage unavailable (private mode): the in-memory toggle still applies
  }
}

/** One labeled switch row. */
function settingsRow(label: string, hint: string, checked: boolean, onChange: (next: boolean) => void): unknown {
  return createElement(
    'label',
    { className: 'dfa-set-row' },
    createElement(
      'span',
      { className: 'dfa-set-text' },
      createElement('span', { className: 'dfa-set-label' }, label),
      createElement('span', { className: 'dfa-set-hint' }, hint),
    ),
    createElement('input', {
      type: 'checkbox',
      className: 'dfa-set-switch',
      checked,
      onChange: (event: { target?: { checked?: boolean } }) => onChange(event?.target?.checked === true),
    }),
  )
}

/** One labeled percent row (issue #384: the right column's default width). */
function settingsPercentRow(label: string, hint: string, value: number, onCommit: (raw: unknown) => void): unknown {
  return createElement(
    'div',
    { className: 'dfa-set-row dfa-set-row-static' },
    createElement(
      'span',
      { className: 'dfa-set-text' },
      createElement('span', { className: 'dfa-set-label' }, label),
      createElement('span', { className: 'dfa-set-hint' }, hint),
    ),
    createElement(
      'span',
      { className: 'dfa-set-field' },
      createElement('input', {
        type: 'number',
        className: 'dfa-set-number',
        min: RIGHTBAR_RATIO_MIN,
        max: RIGHTBAR_RATIO_MAX,
        step: 1,
        value,
        onChange: (event: { target?: { value?: string } }) => onCommit(event?.target?.value),
      }),
      createElement('span', { className: 'dfa-set-unit' }, '%'),
    ),
  )
}

/**
 * Settings panel body: the auto-open switch, the right-sidebar default width,
 * and their explanatory hints.
 */
function FileActivitySettings(): unknown {
  const [enabled, setEnabled] = useState(autoOpenEnabled)
  const [ratio, setRatio] = useState(storedRightbarRatio)
  return createElement(
    'div',
    { className: 'dfa-set', 'data-dfa-settings': '1' },
    createElement('div', { className: 'dfa-set-title' }, strings.title()),
    settingsRow(strings.autoOpenLabel(), strings.autoOpenHint(), enabled, (next) => {
      setAutoOpenEnabled(next)
      setEnabled(next)
    }),
    settingsPercentRow(strings.rightbarWidthLabel(), strings.rightbarWidthHint(), ratio, (raw) => {
      // An illegal / out-of-range edit is rejected outright: the control keeps
      // showing the stored preference instead of a value we would not apply.
      if (!saveRightbarRatio(raw)) return
      setRatio(Number(raw))
    }),
  )
}

/** Register the settings tab into the settings section's list seat. */
function registerSettingsTab(ctx: ClientContext): void {
  ctx.effect(
    () =>
      ctx.slots.inject('settings.plugins.tab', () =>
        ctx.slots.register(
          { name: 'settings.plugins.tab', id: TAB_ID, order: 60, label: () => strings.title() },
          FileActivitySettings,
        ),
      ),
    'dsh-file-activity: settings tab',
  )
}
