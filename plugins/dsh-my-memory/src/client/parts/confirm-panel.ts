// ── confirm-panel: 记忆写操作（新增 / 编辑 / 删除 / 恒定切换）的居中确认弹层 ──
// 从 view-rows.ts 拆出（issue #518 之后该文件逼近 400 行门禁）：条目行渲染与
// 写操作确认是两块独立关注点——前者按条目循环，后者是全局单例弹层，只被
// view.ts 引用。拆分不改变任何语义。
/** 确认状态 */
interface ConfirmingState {
  kind: 'add' | 'update' | 'delete' | 'pin'
  scope: string
  id?: string
  desc?: string
  category?: string
  /** 仅 kind='pin'：目标值（true = 设为恒定，false = 取消恒定）。 */
  pinned?: boolean
}

/** 概要预览行（issue #105）：add/update 内容超长时提示「完整内容保存 + 显示概要」。 */
function SummaryPreview({ desc }: { desc: string }): ReactNode {
  const summary = truncateText(desc, TRUNCATE_LEN)
  return createElement(
    'div',
    { className: 'dsh-my-memory-confirm-summary' },
    createElement('span', { className: 'dsh-my-memory-confirm-summary-label' }, strings.summaryPreview()),
    createElement('span', { className: 'dsh-my-memory-confirm-summary-text' }, summary.text),
  )
}

/** 确认面板标题文案（按 kind 取；未知 kind 回落删除文案）。 */
const CONFIRM_TEXTS: Record<string, (confirm: ConfirmingState) => string> = {
  add: () => strings.confirmAdd(),
  update: () => strings.confirmUpdate(),
  delete: () => strings.confirmDelete(),
  // 恒定切换按**目标值**取文案：设恒定的后果（每轮注入）与取消的后果不同。
  pin: (confirm) => (confirm.pinned === true ? strings.confirmPin() : strings.confirmUnpin()),
}

/** 记忆写操作确认：居中弹层 + 共用 ask 范式卡（保存绿 / 删除红）。 */
function ConfirmPanel({
  confirm,
  onCancel,
  onOk,
  entryLimit,
}: {
  confirm: ConfirmingState
  onCancel: () => void
  onOk: () => void
  entryLimit: number
}): ReactNode {
  const isDelete = confirm.kind === 'delete'
  return createElement(
    'div',
    { className: 'dsh-my-memory-overlay', role: 'presentation' },
    createElement(AskConfirmCard, {
      variant: isDelete ? 'delete' : 'save',
      title: CONFIRM_TEXTS[confirm.kind](confirm),
      scope: confirm.scope,
      category: confirm.category ?? '',
      content: confirm.desc ?? '',
      showSummary: !isDelete && isOverEntryLimit(confirm.desc, entryLimit),
      note: strings.confirmHint(),
      allowLabel: isDelete ? strings.confirmDeleteBtn() : strings.confirmSave(),
      showOptions: false,
      onAllow: onOk,
      onReject: onCancel,
    }),
  )
}

// 导出给其他 part 文件使用
