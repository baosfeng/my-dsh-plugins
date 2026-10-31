// ── components-cards：卡片流（来源分组 + 粘性头 + 技能卡 + 双开关）──────

interface SkillCardProps {
  item: SkillItem
  shared: SkillViewShared
}

function cardClasses(item: SkillItem, selected: boolean): string {
  const classes = ['dsh-my-skill-manager-card']
  if (isAnomaly(item)) classes.push('dsh-my-skill-manager-card-anomaly')
  else if (!item.globalOn) classes.push('dsh-my-skill-manager-card-off')
  if (selected) classes.push('dsh-my-skill-manager-card-selected')
  return classes.join(' ')
}

/** 卡片标题行：名称 + 来源点 + 状态徽标 + 使用热度 + 展开箭头。 */
function cardOpenButton(item: SkillItem, expanded: boolean, shared: SkillViewShared): unknown {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-skill-manager-card-open',
      'aria-expanded': expanded,
      'aria-controls': 'detail-' + item.key,
      title: strings.cardOpenAria(item.name, expanded),
      onClick: () => shared.handlers.onToggleDetail(item),
    },
    createElement('span', { className: 'dsh-my-skill-manager-name' }, item.name),
    createElement('span', {
      className: 'dsh-my-skill-manager-src-dot dsh-my-skill-manager-src-dot-' + item.group,
      'aria-hidden': 'true',
    }),
    skillBadges(item),
    usageElement(item),
    createElement('span', { className: 'dsh-my-skill-manager-chevron' }, icon.chevronDown(14)),
  )
}

/** 卡片顶部：选择模式下的勾选框 + 标题行。 */
function cardTopRow(item: SkillItem, expanded: boolean, selected: boolean, shared: SkillViewShared): unknown {
  const checkbox = shared.selectionMode
    ? createElement('input', {
        type: 'checkbox',
        className: 'dsh-my-skill-manager-checkbox',
        'aria-label': strings.selectRowAria(item.name),
        checked: selected,
        onChange: () => shared.handlers.onToggleSelect(item.key),
      })
    : null
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-card-top' },
    checkbox,
    cardOpenButton(item, expanded, shared),
  )
}

/** 双作用域开关组（全局关时整组降级）。 */
function cardScopes(item: SkillItem, anomaly: boolean, shared: SkillViewShared): unknown {
  const dimmed = !item.globalOn && !anomaly
  return createElement(
    'div',
    {
      className: 'dsh-my-skill-manager-scopes' + (dimmed ? ' dsh-my-skill-manager-scopes-dim' : ''),
    },
    createElement(ScopeSwitch, {
      item,
      scope: 'global',
      checked: item.globalOn,
      disabled: anomaly,
      projectCtx: shared.projectCtx,
      onToggle: shared.handlers.onToggleScope,
    }),
    createElement(ScopeSwitch, {
      item,
      scope: 'project',
      checked: item.projectOn,
      disabled: anomaly,
      projectCtx: shared.projectCtx,
      onToggle: shared.handlers.onToggleScope,
    }),
  )
}

function cardFoot(item: SkillItem, anomaly: boolean, shared: SkillViewShared): unknown {
  const note = footNote(item, shared.projectCtx)
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-card-foot' },
    cardScopes(item, anomaly, shared),
    note === '' ? null : createElement('span', { className: 'dsh-my-skill-manager-foot-note' }, note),
  )
}

/** 一张技能卡：状态竖条 + 标题行 + 单行描述 + 双开关 + 脚注 + 内联错误 + 展开详情。 */
function SkillCard(props: SkillCardProps): unknown {
  const item = props.item
  const shared = props.shared
  const expanded = shared.expanded.indexOf(item.key) !== -1
  const selected = shared.selected.indexOf(item.key) !== -1
  const anomaly = isAnomaly(item)
  const error = shared.inlineError !== null && shared.inlineError.key === item.key ? shared.inlineError : null
  return createElement(
    'article',
    {
      className: cardClasses(item, selected),
      'data-expanded': expanded ? 'true' : 'false',
      'data-id': item.key,
      onClick: (event: unknown) => {
        if (!isInteractiveEvent(event)) shared.handlers.onToggleDetail(item)
      },
    },
    createElement('span', { className: 'dsh-my-skill-manager-card-bar', 'aria-hidden': 'true' }),
    cardTopRow(item, expanded, selected, shared),
    createElement('p', { className: 'dsh-my-skill-manager-desc' }, item.description),
    cardFoot(item, anomaly, shared),
    error === null ? null : createElement(InlineError, { item, error, onRetry: shared.handlers.onRetryInline }),
    expanded
      ? createElement(FocusDetail, {
          id: 'detail-' + item.key,
          item,
          detail: shared.details[item.key],
          projectCtx: shared.projectCtx,
          handlers: shared.handlers,
        })
      : null,
  )
}

interface CardsViewProps {
  groups: SkillGroup[]
  shared: SkillViewShared
}

/** 来源分组头：来源点 + 名称 + 计数 + 来源/provider 说明。 */
function groupHead(group: SkillGroup): unknown {
  return createElement(
    'header',
    { className: 'dsh-my-skill-manager-group-head' },
    createElement('span', {
      className: 'dsh-my-skill-manager-src-dot dsh-my-skill-manager-src-dot-' + group.group,
      'aria-hidden': 'true',
    }),
    createElement('h3', {}, groupLabelOf(group.group)),
    createElement('span', { className: 'dsh-my-skill-manager-group-count' }, String(group.items.length)),
    createElement('span', { className: 'dsh-my-skill-manager-group-provider' }, groupProviderOf(group)),
  )
}

function CardsView(props: CardsViewProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-list' },
    props.groups.map((group) =>
      createElement(
        'section',
        { key: group.group, className: 'dsh-my-skill-manager-group', 'data-group': group.group },
        groupHead(group),
        createElement(
          'div',
          { className: 'dsh-my-skill-manager-group-body' },
          group.items.map((item) => createElement(SkillCard, { key: item.key, item, shared: props.shared })),
        ),
      ),
    ),
  )
}
