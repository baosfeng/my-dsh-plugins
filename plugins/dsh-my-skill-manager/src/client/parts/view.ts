// ── view：设置页 tab 的根组件（状态在 deck-state，渲染在 view-render）───
// 单 hook 入口：useDeck() 持有全部状态与生命周期，renderDeck() 组装节点。
// 组件本身不写业务逻辑，保证「一个 tab 组件 = 一个状态源 + 一棵渲染树」。

function SkillManagerView(): unknown {
  return renderDeck(useDeck())
}
