// ── styles/STYLE_TOKENS：技能台样式分片（构建期按顺序拼接为 STYLES）───────
const STYLE_TOKENS: string = `

.dsh-my-skill-manager-root {
  /* 局部语义别名：全部由 --dsw-* 派生，便于把原型的一整套 --sk-* 色板
     映射到宿主的语义槽；深浅主题跟随宿主自动适配。 */
  --skm-surface: var(--dsw-alias-bg-layer-2);
  --skm-surface-2: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-layer-2));
  --skm-surface-3: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, var(--dsw-alias-bg-layer-2));
  --skm-border: var(--dsw-alias-border-l2);
  --skm-border-strong: var(--dsw-alias-border-l4, var(--dsw-alias-border-l3));
  --skm-hover: var(--dsw-alias-interactive-bg-hover);
  --skm-accent: var(--dsw-alias-accent, var(--dsw-alias-state-business-primary));
  --skm-accent-strong: color-mix(in srgb, var(--skm-accent) 76%, var(--dsw-alias-label-primary));
  --skm-accent-soft: color-mix(in srgb, var(--skm-accent) 14%, transparent);
  --skm-accent-ring: color-mix(in srgb, var(--skm-accent) 30%, transparent);
  --skm-success: var(--dsw-alias-state-success-primary);
  --skm-warn: var(--dsw-alias-state-warn-primary);
  --skm-danger: var(--dsw-alias-state-error-primary);
  --skm-warn-soft: color-mix(in srgb, var(--skm-warn) 14%, transparent);
  --skm-danger-soft: color-mix(in srgb, var(--skm-danger) 14%, transparent);
  --skm-on-accent: var(--dsw-alias-label-primary-foreground);
  --skm-code-bg: var(--dsw-alias-markdown-code-block);
  --skm-code-fg: var(--dsw-alias-label-secondary);
  --skm-track: color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);
  --skm-knob: var(--dsw-alias-switch-thumb, var(--dsw-alias-label-primary-foreground));
  --skm-selected: color-mix(in srgb, var(--skm-accent) 12%, var(--dsw-alias-bg-layer-2));
  --skm-scroll: var(--dsw-alias-scrollbar-hover-l1, var(--dsw-alias-label-dimmed));
  --skm-shadow: var(--dsw-shadow-lv2);
  --skm-ease: var(--ds-transition-duration-slow) var(--ds-ease-in-out);

  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  /* 宿主设置面板 800px 高、内容列 564px 宽；技能台在页签下方占一个有界
     高度（约 620px，原型内容区），内部列表自己滚动，不再叠加外层滚动。 */
  height: min(620px, calc(100vh - 260px));
  min-height: 320px;
  max-height: 100%;
  overflow: hidden;
  padding: 2px 6px 8px;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-13);
}
.dsh-my-skill-manager-root *,
.dsh-my-skill-manager-root *::before,
.dsh-my-skill-manager-root *::after { box-sizing: border-box; }
.dsh-my-skill-manager-root button {
  margin: 0; padding: 0; border: 0; background: none; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}
.dsh-my-skill-manager-root input { font: inherit; }
.dsh-my-skill-manager-root code,
.dsh-my-skill-manager-root pre,
.dsh-my-skill-manager-root kbd {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
}
.dsh-my-skill-manager-root svg { display: block; flex: none; }
.dsh-my-skill-manager-root ::selection {
  background: color-mix(in srgb, var(--skm-accent) 26%, transparent);
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-root :where(button, input, a, [tabindex]):focus-visible {
  outline: 2px solid var(--skm-accent);
  outline-offset: 2px;
  border-radius: 6px;
}
.dsh-my-skill-manager-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
@keyframes dsh-my-skill-manager-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes dsh-my-skill-manager-spin { to { transform: rotate(360deg); } }
@keyframes dsh-my-skill-manager-pulse { 0%, 100% { opacity: .5; } 50% { opacity: .9; } }

`.trim()
