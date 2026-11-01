/** 分区 1：呈现（系统通知 / 页面 toast / 提示音 / 免打扰与去重 / 权限与自检）。 */
function renderPresentPane(draft: NotifyConfig, patch: PatchFn, volume: number, onVolumeChange: (v: number) => void) {
  const toast = draft.toast ?? defaultConfig().toast!
  const sound = draft.sound ?? defaultConfig().sound!
  const system = draft.system ?? defaultConfig().system!
  const quiet = draft.quietHours ?? { enabled: false, start: '23:00', end: '08:00' }
  const perm = permissionBadge()
  const patchToast = (key: string, value: unknown) => patch('toast', { ...toast, [key]: value })
  const patchSound = (key: string, value: unknown) => patch('sound', { ...sound, [key]: value })
  const patchSystem = (key: string, value: unknown) => patch('system', { ...system, [key]: value })
  const patchQuiet = (key: string, value: unknown) => patch('quietHours', { ...quiet, [key]: value })
  const { positions, durations, stacks, tones } = presentOptions()
  const ctx = {
    system,
    patchSystem,
    perm,
    toast,
    patchToast,
    positions,
    durations,
    stacks,
    sound,
    patchSound,
    tones,
    quiet,
    patchQuiet,
    draft,
    patch,
    volume,
    onVolumeChange,
  }
  return createElement(
    'div',
    { className: 'dsh-my-notify-pane', role: 'tabpanel', 'aria-label': strings.panePresent() },
    createElement(
      'div',
      { className: 'dsh-my-notify-pane-hd' },
      createElement('h2', null, strings.panePresent()),
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.presentHint()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-grid2' },
      presentSystemCard(ctx),
      presentToastCard(ctx),
      presentSoundCard(ctx),
      presentQuietCard(ctx),
      presentSelfCheckCard(ctx),
    ),
  )
}

/** 系统通知卡片（桌面通知 / 常驻 / 权限徽标）。 */
function presentSystemCard(ctx: any) {
  const { system, patchSystem, perm } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.systemTitle()),
      createElement('span', { className: 'dsh-my-notify-badge', 'data-kind': perm.kind }, perm.text),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.systemEnable(),
        hint: strings.systemEnableHint(),
        // 回显以运行时 gate（localStorage 覆盖）为准，避免「面板显示开、实际不弹」
        on: prefOn(LS.notify, system.enabled !== false),
        onChange: (v: boolean) => {
          patchSystem('enabled', v)
          writePref(LS.notify, v)
        },
      }),
      createElement(SwitchRow, {
        label: strings.systemPersist(),
        hint: strings.systemPersistHint(),
        on: system.requireInteraction === true,
        onChange: (v: boolean) => patchSystem('requireInteraction', v),
      }),
    ),
  )
}

/** 页面 toast 卡片（启用 / 位置 / 时长 / 堆叠）。 */
function presentToastCard(ctx: any) {
  const { toast, patchToast, positions, durations, stacks } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.toastTitle2()),
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.toastEnableHint()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.toastTitle2(),
        hint: strings.toastEnableHint(),
        on: prefOn(LS.toast, toast.enabled !== false),
        onChange: (v: boolean) => {
          patchToast('enabled', v)
          writePref(LS.toast, v)
        },
      }),
      createElement(SelectRow, {
        label: strings.toastPosition(),
        hint: strings.toastEnableHint(),
        value: toast.position,
        options: positions,
        onChange: (v: string) => patchToast('position', v),
      }),
      createElement(SelectRow, {
        label: strings.toastDuration(),
        hint: strings.ms(),
        value: String(toast.durationMs),
        options: durations,
        onChange: (v: string) => patchToast('durationMs', Number(v)),
      }),
      createElement(SelectRow, {
        label: strings.toastMaxStack(),
        hint: strings.toastHoverPause(),
        value: String(toast.maxStack),
        options: stacks,
        onChange: (v: string) => patchToast('maxStack', Number(v)),
      }),
    ),
  )
}

/** 提示音卡片（启用 / 音色 + 试听 / 音量）。 */
function presentSoundCard(ctx: any) {
  const { sound, patchSound, tones, onVolumeChange } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.soundTitle()),
      createElement('span', { className: 'dsh-my-notify-badge' }, optionTextOf(tones, sound.preset)),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.soundEnable(),
        hint: strings.soundEnableHint(),
        // 回显以运行时 gate（localStorage 覆盖）为准：beep() 优先读 LS.sound
        on: prefOn(LS.sound, sound.enabled !== false),
        onChange: (v: boolean) => {
          patchSound('enabled', v)
          writePref(LS.sound, v)
        },
      }),
      soundToneRow({ sound, patchSound, tones }),
      createElement(VolumeRow, {
        label: strings.settingsVolume(),
        hint: strings.settingsVolumeHint(),
        // 回显规则与运行时一致：本地键优先，缺失回退 config.sound.volume
        value: prefNum(LS.volume, sound.volume),
        onChange: (v: number) => {
          // 双写：server 配置（持久化）+ localStorage（beep 运行时取值）
          patchSound('volume', v)
          writePrefNum(LS.volume, v)
          onVolumeChange(v)
        },
      }),
    ),
  )
}

/** 免打扰与去重卡片。 */
function presentQuietCard(ctx: any) {
  const { quiet, patchQuiet, draft, patch } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.quietDedupeTitle()),
      createElement(
        'span',
        {
          className: 'dsh-my-notify-badge',
          'data-kind': quiet.enabled === true ? 'warn' : 'ok',
        },
        quiet.enabled === true ? strings.settingsQuietHoursEnabled() : strings.channelDisabled(),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.quietEnable(),
        hint: strings.quietEnableHint(),
        on: quiet.enabled === true,
        onChange: (v: boolean) => patchQuiet('enabled', v),
      }),
      createElement(
        'div',
        { className: 'dsh-my-notify-grid2' },
        createElement(TextRow, {
          label: strings.quietStart(),
          hint: '23:00',
          value: quiet.start,
          type: 'time',
          onChange: (v: string) => patchQuiet('start', v),
        }),
        createElement(TextRow, {
          label: strings.quietEnd(),
          hint: '08:00',
          value: quiet.end,
          type: 'time',
          onChange: (v: string) => patchQuiet('end', v),
        }),
      ),
      createElement('div', { className: 'dsh-my-notify-divider' }),
      createElement(TextRow, {
        label: strings.dedupeWindow(),
        hint: strings.dedupeWindowHint(),
        value: String(draft.dedupeMs ?? 3000),
        type: 'number',
        onChange: (v: string) => patch('dedupeMs', Number(v) || 0),
      }),
    ),
  )
}

/** 权限与自检卡片（权限态 / 音色可用 / 悬停暂停）。 */
function presentSelfCheckCard(ctx: any) {
  const { perm } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.permSelfCheck()),
      createElement('span', { className: 'dsh-my-notify-badge', 'data-kind': perm.kind }, perm.text),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement('div', { className: 'dsh-my-notify-status-line' }, strings.systemTitle() + ' · ' + perm.text),
      createElement('div', { className: 'dsh-my-notify-status-line' }, strings.soundAvailable()),
      createElement('div', { className: 'dsh-my-notify-status-line' }, strings.toastHoverPause()),
    ),
  )
}

/** 呈现分区用到的枚举选项（位置 / 时长 / 堆叠 / 音色）。 */
function presentOptions(): {
  positions: SelectOption[]
  durations: SelectOption[]
  stacks: SelectOption[]
  tones: SelectOption[]
} {
  const positions: SelectOption[] = [
    { value: 'top-right', label: () => strings.posTopRight() },
    { value: 'top-left', label: () => strings.posTopLeft() },
    { value: 'bottom-right', label: () => strings.posBottomRight() },
    { value: 'bottom-left', label: () => strings.posBottomLeft() },
    { value: 'top', label: () => strings.posTop() },
    { value: 'bottom', label: () => strings.posBottom() },
  ]
  const durations: SelectOption[] = [
    { value: '3000', label: () => strings.dur3s() },
    { value: '5000', label: () => strings.dur5s() },
    { value: '8000', label: () => strings.dur8s() },
  ]
  const stacks: SelectOption[] = [
    { value: '1', label: () => strings.stack1() },
    { value: '3', label: () => strings.stack3() },
    { value: '5', label: () => strings.stack5() },
  ]
  const tones: SelectOption[] = [
    { value: 'chime', label: () => strings.toneChime() },
    { value: 'drop', label: () => strings.toneDrop() },
    { value: 'deep', label: () => strings.toneDeep() },
  ]
  return { positions, durations, stacks, tones }
}

/** 音色下拉 + 试听按钮（提示音卡片内部一行，写回 preset 与本地音色）。 */
function soundToneRow(props: {
  sound: SoundConfig
  patchSound: (key: string, value: unknown) => void
  tones: SelectOption[]
}) {
  const { sound, patchSound, tones } = props
  return createElement(
    'div',
    { className: 'dsh-my-notify-form-row' },
    createElement('span', { className: 'dsh-my-notify-label' }, strings.soundTone()),
    createElement(
      'select',
      {
        className: 'dsh-my-notify-webhook-select',
        value: sound.preset,
        'aria-label': strings.soundTone(),
        onChange: (event: any) => {
          patchSound('preset', event.target.value)
          try {
            window.localStorage.setItem(LS.tone, event.target.value)
          } catch {
            // 存储不可用：试听仍用默认音色
            void 0
          }
        },
      },
      tones.map((option) => createElement('option', { key: option.value, value: option.value }, option.label())),
    ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn', onClick: () => beep(sound.preset) },
      strings.soundTest(),
    ),
  )
}
