// ── glyphs：技能台专用线性图标（与 dsh-shared 图标集同构）──────────────
// 只补共享集里没有的形状（视图切换 / 排序 / 使用热度 / 选择 / 返回 / 空态），
// stroke=currentColor、1.8、viewBox 24、round 端点，与共享图标一致。
const glyph = {
  cards: (size = 13) =>
    iconSvg(
      [
        createElement('rect', { x: 3, y: 4, width: 18, height: 7, rx: 2 }),
        createElement('rect', { x: 3, y: 14, width: 18, height: 6, rx: 2 }),
      ],
      size,
    ),
  table: (size = 13) =>
    iconSvg(
      [
        createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        createElement('path', { d: 'M3 10h18M9 10v10' }),
      ],
      size,
    ),
  filter: (size = 13) => iconSvg([createElement('path', { d: 'M4 5h16l-6.4 7.6V20l-3.2-1.7v-5.7L4 5Z' })], size),
  sort: (size = 13) =>
    iconSvg(
      [
        createElement('path', { d: 'M4 7h10M18 7h2M4 17h4M12 17h8' }),
        createElement('circle', { cx: 16, cy: 7, r: 2 }),
        createElement('circle', { cx: 10, cy: 17, r: 2 }),
      ],
      size,
    ),
  activity: (size = 12) => iconSvg([createElement('path', { d: 'M3 12h4l2.5 6 4-14 2.5 8H21' })], size),
  checkSquare: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }),
        createElement('path', { d: 'm8 12 3 3 5-6' }),
      ],
      size,
    ),
  back: (size = 16) =>
    iconSvg([createElement('path', { d: 'M19 12H5' }), createElement('path', { d: 'm11 6-6 6 6 6' })], size),
  arrowUp: (size = 12) =>
    iconSvg([createElement('path', { d: 'M12 19V5' }), createElement('path', { d: 'm6 11 6-6 6 6' })], size),
  arrowDown: (size = 12) =>
    iconSvg([createElement('path', { d: 'M12 5v14' }), createElement('path', { d: 'm6 13 6 6 6-6' })], size),
  sortNeutral: (size = 12) =>
    iconSvg([createElement('path', { d: 'm8 9 4-4 4 4' }), createElement('path', { d: 'm8 15 4 4 4-4' })], size),
  package: (size = 28) =>
    iconSvg(
      [
        createElement('path', { d: 'M3 7l9-4 9 4-9 4-9-4Z' }),
        createElement('path', { d: 'M3 7v10l9 4 9-4V7' }),
        createElement('path', { d: 'M12 11v10' }),
      ],
      size,
    ),
  fileMissing: (size = 28) =>
    iconSvg(
      [
        createElement('path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z' }),
        createElement('path', { d: 'M14 3v5h5' }),
        createElement('path', { d: 'M9 14h6' }),
      ],
      size,
    ),
}
