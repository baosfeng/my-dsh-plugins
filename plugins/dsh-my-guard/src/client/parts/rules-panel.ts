// ── 自定义护栏规则 + 告警通知（issue #88）─────────────────────────
// 依赖：strings（i18n）、icon（共享图标）、apiJson/severityLabel（panel.js）、
// busyState/cleanFeedback/errorFeedback（states.js）；本片段在 STATES 之后拼接。

/** 模式 → 中文标签。 */
function modeLabel(mode: string): string {
  if (mode === 'ask') return strings.modeAsk()
  if (mode === 'deny') return strings.modeDeny()
  return strings.modeObserve()
}

/** 规则来源 → 中文标签。 */
function ruleSourceLabel(source: string): string {
  return strings.ruleHitSource(source)
}

/** 单条自定义规则行（pattern + mode + severity + description + 删除）。 */
function RuleEntry({ rule, index, onChange, onRemove }: GuardRuleEntryProps) {
  const update = (patch: Partial<GuardCustomRule>) => onChange(index, patch)
  return createElement(
    'div',
    { className: 'dsh-my-guard-rule-row' },
    createElement('input', {
      className: 'dsh-my-guard-input dsh-my-guard-rule-pattern',
      value: rule.pattern || '',
      placeholder: strings.patternPlaceholder(),
      onChange: (e) => update({ pattern: e.target.value }),
    }),
    createElement(
      'select',
      {
        className: 'dsh-my-guard-input dsh-my-guard-rule-select',
        value: rule.mode,
        'aria-label': strings.modeLabel(),
        onChange: (e) => update({ mode: e.target.value }),
      },
      createElement('option', { value: 'observe' }, strings.modeObserve()),
      createElement('option', { value: 'ask' }, strings.modeAsk()),
      createElement('option', { value: 'deny' }, strings.modeDeny()),
    ),
    createElement(
      'select',
      {
        className: 'dsh-my-guard-input dsh-my-guard-rule-select',
        value: rule.severity,
        'aria-label': strings.severityLabel(),
        onChange: (e) => update({ severity: e.target.value }),
      },
      createElement('option', { value: 'low' }, strings.sevLow()),
      createElement('option', { value: 'medium' }, strings.sevMedium()),
      createElement('option', { value: 'high' }, strings.sevHigh()),
    ),
    createElement('input', {
      className: 'dsh-my-guard-input dsh-my-guard-rule-desc',
      value: rule.description || '',
      placeholder: strings.descriptionPlaceholder(),
      onChange: (e) => update({ description: e.target.value }),
    }),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-guard-iconbtn',
        'aria-label': strings.deleteRuleAria(),
        title: strings.deleteRule(),
        onClick: () => onRemove(index),
      },
      icon.trash(14),
    ),
  )
}

/** 规则测试结果：命中列表（来源/模式/严重级）+ 合并决策。 */
function RuleTestResult({ result }: GuardRuleTestResultProps) {
  const hits = result?.hits || []
  const decision = result?.decision
  return createElement(
    'div',
    { className: 'dsh-my-guard-feedback' },
    hits.length === 0
      ? cleanFeedback(strings.noRuleHit())
      : createElement(
          'div',
          { className: 'dsh-my-guard-feedback' },
          createElement('div', { className: 'dsh-my-guard-feedback-head' }, `${strings.ruleTestResult()}：`),
          hits.map((h, index) =>
            createElement(
              'div',
              { key: index, className: `dsh-my-guard-issue dsh-my-guard-issue-${h.severity}` },
              createElement('div', { className: 'dsh-my-guard-issue-sev' }, severityLabel(h.severity)),
              createElement('div', { className: 'dsh-my-guard-issue-msg' }, `${modeLabel(h.mode)} · ${h.message}`),
              createElement('div', { className: 'dsh-my-guard-issue-rule' }, `${ruleSourceLabel(h.source)} · ${h.id}`),
            ),
          ),
          decision
            ? createElement(
                'div',
                { className: 'dsh-my-guard-issue-rule dsh-my-guard-effective' },
                `${strings.effectiveDecision()}: ${modeLabel(decision.mode)} / ${severityLabel(decision.severity)}`,
              )
            : null,
        ),
  )
}

/** 规则测试：输入命令 → 实时预览命中规则 + 合并决策。 */
function RuleTest() {
  const [command, setCommand] = useState('')
  const [result, setResult] = useState<GuardRuleTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async () => {
    const value = command.trim()
    if (value === '') {
      setError(strings.noCommand())
      return
    }
    setBusy(true)
    setError('')
    try {
      setResult(
        await apiJson('/guard/api/rules/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command: value }),
        }),
      )
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setResult(null)
    } finally {
      setBusy(false)
    }
  }
  return createElement(
    'div',
    { className: 'dsh-my-guard-section' },
    createElement('div', { className: 'dsh-my-guard-section-title' }, strings.ruleTestTitle()),
    createElement(
      'div',
      { className: 'dsh-my-guard-tool-row' },
      createElement('input', {
        className: 'dsh-my-guard-input dsh-my-guard-tool-input',
        value: command,
        placeholder: strings.ruleTestPlaceholder(),
        disabled: busy,
        onChange: (e) => setCommand(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter') void run()
        },
      }),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-guard-btn dsh-my-guard-btn-primary',
          disabled: busy,
          onClick: () => void run(),
        },
        icon.search(14),
        createElement('span', null, strings.ruleTest()),
      ),
    ),
    busy ? busyState(strings.checking()) : null,
    error !== '' ? errorFeedback(`${strings.loadError()}：${error}`) : null,
    result !== null ? createElement(RuleTestResult, { result }) : null,
  )
}

/** 自定义护栏规则设置：列表编辑 + 保存（持久化 profile patch）+ 通知开关。 */
function RuleSettings(): unknown {
  const [customRules, setCustomRules] = useState<GuardCustomRule[]>([])
  const [notifyEnabled, setNotifyEnabled] = useState(false)
  const [notifyCooldownSec, setNotifyCooldownSec] = useState(60)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void apiJson('/guard/api/rules')
      .then((value) => {
        if (!alive) return
        setCustomRules(value.custom || [])
        setNotifyEnabled(value.notifyEnabled === true)
        if (typeof value.notifyCooldownMs === 'number') setNotifyCooldownSec(Math.round(value.notifyCooldownMs / 1000))
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [])

  const changeRule = (index: number, patch: Partial<GuardCustomRule>) =>
    setCustomRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const addRule = () =>
    setCustomRules((prev) => [...prev, { pattern: '', mode: 'observe', severity: 'medium', description: '' }])
  const removeRule = (index: number) => setCustomRules((prev) => prev.filter((_, i) => i !== index))

  const save = async (): Promise<void> => {
    setBusy(true)
    setFeedback('')
    setError('')
    try {
      const result = await apiJson('/guard/api/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customRules, notifyEnabled, notifyCooldownMs: notifyCooldownSec * 1000 }),
      })
      setCustomRules(result.customRules || [])
      setNotifyEnabled(result.notifyEnabled === true)
      if (typeof result.notifyCooldownMs === 'number') setNotifyCooldownSec(Math.round(result.notifyCooldownMs / 1000))
      setFeedback(result.dropped > 0 ? strings.droppedRule(result.dropped) : strings.saveRulesOk())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return ruleSettingsView({
    customRules,
    notifyEnabled,
    notifyCooldownSec,
    busy,
    feedback,
    error,
    changeRule,
    addRule,
    removeRule,
    save,
    setNotifyEnabled,
    setNotifyCooldownSec,
  })
}

function ruleSettingsView(view: GuardRuleSettingsView): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-guard-section dsh-my-guard-rules-section' },
    createElement('div', { className: 'dsh-my-guard-section-title' }, strings.rulesTitle()),
    createElement('div', { className: 'dsh-my-guard-rules-hint' }, strings.rulesHint()),
    view.customRules.length === 0
      ? createElement('div', { className: 'dsh-my-guard-empty-rules' }, strings.emptyRules())
      : createElement(
          'div',
          { className: 'dsh-my-guard-rule-list' },
          view.customRules.map((rule, index) =>
            createElement(RuleEntry, { key: index, rule, index, onChange: view.changeRule, onRemove: view.removeRule }),
          ),
        ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-guard-btn', onClick: view.addRule },
      createElement('span', null, strings.addRule()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-guard-notify-row' },
      createElement(
        'label',
        { className: 'dsh-my-guard-check' },
        createElement('input', {
          type: 'checkbox',
          checked: view.notifyEnabled,
          onChange: (e) => view.setNotifyEnabled(e.target.checked),
        }),
        createElement('span', null, strings.notifyLabel()),
      ),
      createElement(
        'label',
        { className: 'dsh-my-guard-cooldown' },
        createElement('span', null, strings.cooldownLabel()),
        createElement('input', {
          className: 'dsh-my-guard-input dsh-my-guard-cooldown-input',
          type: 'number',
          min: '0',
          value: view.notifyCooldownSec,
          onChange: (e) => view.setNotifyCooldownSec(Number(e.target.value) || 0),
        }),
      ),
    ),
    createElement('div', { className: 'dsh-my-guard-notify-hint' }, strings.notifyHint()),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-guard-btn dsh-my-guard-btn-primary',
        disabled: view.busy,
        onClick: () => void view.save(),
      },
      icon.check(14),
      createElement('span', null, strings.saveRules()),
    ),
    view.busy ? busyState(strings.loading()) : null,
    view.error !== '' ? errorFeedback(`${strings.loadRulesError()}：${view.error}`) : null,
    view.feedback !== '' ? cleanFeedback(view.feedback) : null,
  )
}
