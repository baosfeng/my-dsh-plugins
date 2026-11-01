/** 卡片默认值（与服务端 normalizeCard 的缺省一致；字段默认勾选常用 5 项）。 */
function defaultCard(): CardConfig {
  return {
    schemaVersion: '2.0',
    template: '',
    // 默认勾选常用 5 项（不含「时间」），顺序即 CARD_FIELD_OPTIONS 顺序
    fields: CARD_FIELD_OPTIONS.filter((option) => option.value !== 'event.time').map((option) => option.value),
    buttonText: strings.dzButtonDefault(),
    mentionOpenIds: [],
    mentionAll: false,
    accentByKind: true,
  }
}

/** 卡片字段集（勾选状态 / 导出 JSON / 预览与实发消息共用同一有序数组）。 */
function cardFieldsOf(card: CardConfig | undefined): string[] {
  const allowed = CARD_FIELD_OPTIONS.map((option) => option.value)
  const raw = card !== null && card !== undefined && Array.isArray(card.fields) ? card.fields : []
  const fields: string[] = []
  for (const name of raw) {
    // 只保留已知字段，按用户勾选顺序（去重）
    if (allowed.includes(name) && !fields.includes(name)) fields.push(name)
  }
  return fields
}

/** 卡片配置（缺失字段按默认值补齐）。 */
function cardOf(webhook: WebhookEntry): CardConfig {
  const base = defaultCard()
  const card = webhook.card
  if (card === null || card === undefined || typeof card !== 'object') return base
  return {
    schemaVersion: typeof card.schemaVersion === 'string' ? card.schemaVersion : base.schemaVersion,
    template: typeof card.template === 'string' ? card.template : (base.template as string),
    fields: cardFieldsOf(card),
    buttonText:
      typeof card.buttonText === 'string' && card.buttonText !== '' ? card.buttonText : (base.buttonText as string),
    mentionOpenIds: Array.isArray(card.mentionOpenIds) ? card.mentionOpenIds : [],
    mentionAll: card.mentionAll === true,
    accentByKind: card.accentByKind !== false,
  }
}

/** 飞书卡片设计器：标题模板 / 主题色 + 按事件自动 / 字段勾选 / 按钮 / @ 提醒 / 预览 + JSON。 */
function WebhookDesigner(props: { draft: WebhookEntry; onChange: (next: WebhookEntry) => void }) {
  const card = cardOf(props.draft)
  const [view, setView] = useState<string>('design')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  // 失败态：预览接口不可用时给明确提示（而不是一直显示「加载中」）
  const [failed, setFailed] = useState<boolean>(false)
  const patchCard = (key: string, value: unknown) => {
    props.onChange({ ...props.draft, card: { ...card, [key]: value } })
  }
  const toggleField = (name: string) => {
    const fields = card.fields ?? []
    patchCard('fields', fields.includes(name) ? fields.filter((f) => f !== name) : [...fields, name])
  }
  // 卡片改动 → 300ms 去抖请求预览（与服务端真实构建结果一致）
  useEffect(() => {
    const scheduler = createPreviewScheduler((payload) => {
      void requestPreview(payload).then((value) => {
        setPreview(value)
        setFailed(value === null)
      })
    }, 300)
    scheduler.schedule({
      kind: 'end',
      channel: 'feishu',
      // 预览样例带一句问题，保证勾选「问题」字段时预览与实发一致
      sample: { question: strings.sampleQuestion() },
      titleTemplate: props.draft.titleTemplate ?? '',
      bodyTemplate: props.draft.bodyTemplate ?? '',
      card,
    })
    return () => scheduler.cancel()
  }, [props.draft.card, props.draft.titleTemplate, props.draft.bodyTemplate])
  const ctx = { draft: props.draft, card, patchCard, toggleField, onChange: props.onChange, preview, failed }
  return createElement(
    'div',
    { className: 'dsh-my-notify-design' },
    createElement(
      'div',
      { className: 'dsh-my-notify-design-hd' },
      createElement('b', null, strings.designerTitle()),
      createElement('span', { className: 'dsh-my-notify-badge', 'data-kind': 'accent' }, 'interactive'),
      createElement('span', { className: 'dsh-my-notify-grow' }),
      createElement(
        'div',
        { className: 'dsh-my-notify-segmented', role: 'tablist', 'aria-label': strings.designerView() },
        ['design', 'json'].map((item) =>
          createElement(
            'button',
            {
              key: item,
              type: 'button',
              className: 'dsh-my-notify-seg',
              role: 'tab',
              'aria-selected': String(item === view),
              onClick: () => setView(item),
            },
            item === 'design' ? strings.designerView() : strings.viewJson(),
          ),
        ),
      ),
    ),
    view === 'json'
      ? createElement(
          'pre',
          { className: 'dsh-my-notify-pv-json' },
          JSON.stringify(preview !== null ? preview.card : { schema: '2.0', card }, null, 2),
        )
      : createElement('div', { className: 'dsh-my-notify-design-grid' }, designerControls(ctx), designerPreview(ctx)),
  )
}

/** 设计器左列：标题模板 / 主题色 + 按事件自动 / 字段勾选 / 按钮 / @ 提醒。 */
/** 设计器左列：标题模板 + 主题色（按事件自动）。 */
/** 设计器左列：标题模板 + 主题色（按事件自动）+ 字段勾选 / 按钮 / @ 提醒。 */
function designerControls(ctx: any) {
  const { draft, card, patchCard, onChange } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-copy-stack' },
    createElement(
      'label',
      { className: 'dsh-my-notify-webhook-field' },
      createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.dzCardTitle()),
      textInput(draft.titleTemplate ?? '', '{{session.title}}', (v) => onChange({ ...draft, titleTemplate: v })),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-webhook-field' },
      createElement(
        'span',
        { className: 'dsh-my-notify-webhook-field-label' },
        strings.dzAccent(),
        createElement('span', { className: 'dsh-my-notify-hint' }, '· ' + strings.dzAccentAuto()),
      ),
      createElement(
        'div',
        { className: 'dsh-my-notify-swatches' },
        CARD_ACCENTS.map((option) =>
          createElement(
            'button',
            {
              key: option.value,
              type: 'button',
              className: 'dsh-my-notify-swatch',
              'data-c': option.value,
              'aria-pressed': String(card.accentByKind !== true && card.template === option.value),
              'aria-label': option.label(),
              onClick: () => onChange({ ...draft, card: { ...card, template: option.value, accentByKind: false } }),
            },
            createElement('i'),
          ),
        ),
        createElement(
          'label',
          { className: 'dsh-my-notify-cbx' },
          createElement('input', {
            type: 'checkbox',
            checked: card.accentByKind !== false,
            onChange: (event: any) => patchCard('accentByKind', event.target.checked),
          }),
          strings.dzAccentAuto(),
        ),
      ),
    ),
    designerOptionFields(ctx),
  )
}

function designerOptionFields(ctx: any) {
  const { card, patchCard, toggleField } = ctx
  return [
    createElement(
      'div',
      { className: 'dsh-my-notify-webhook-field' },
      createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.dzFields()),
      createElement(
        'div',
        { className: 'dsh-my-notify-dz-fields' },
        CARD_FIELD_OPTIONS.map((option) =>
          createElement(
            'label',
            { key: option.value, className: 'dsh-my-notify-cbx' },
            createElement('input', {
              type: 'checkbox',
              checked: cardFieldsOf(card).includes(option.value),
              onChange: () => toggleField(option.value),
            }),
            option.label(),
          ),
        ),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-grid2' },
      createElement(
        'label',
        { className: 'dsh-my-notify-webhook-field' },
        createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.dzButton()),
        textInput(card.buttonText ?? '', strings.dzButton(), (v) => patchCard('buttonText', v)),
      ),
      createElement(
        'label',
        { className: 'dsh-my-notify-webhook-field' },
        createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.dzMention()),
        textInput((card.mentionOpenIds ?? []).join(','), 'ou_xxxxxxxx', (v) =>
          patchCard(
            'mentionOpenIds',
            v
              .split(',')
              .map((item) => item.trim())
              .filter((item) => item !== ''),
          ),
        ),
      ),
    ),
    createElement(
      'label',
      { className: 'dsh-my-notify-cbx' },
      createElement('input', {
        type: 'checkbox',
        checked: card.mentionAll === true,
        onChange: (event: any) => patchCard('mentionAll', event.target.checked),
      }),
      strings.dzMentionAll(),
    ),
  ]
}

/** 设计器右列：客户端级卡片预览 + 统计注脚。 */
function designerPreview(ctx: any) {
  const { preview, failed } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-copy-stack' },
    createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.dzPreviewLabel()),
    createElement('div', {
      className: 'dsh-my-notify-pv-stage',
      dangerouslySetInnerHTML: { __html: preview !== null ? renderFeishuCardHtml(preview.card) : '' },
    }),
    createElement(
      'span',
      { className: 'dsh-my-notify-hint' },
      failed ? strings.previewFailed() : preview !== null ? cardMetaOf(preview.card) : strings.previewLoading(),
    ),
  )
}
