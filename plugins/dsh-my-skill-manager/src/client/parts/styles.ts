// ── styles：技能台（Skill Deck）样式拼装 ────────────────────────────────
// 视觉以 docs/原型重构/dsh-my-skill-manager.html 为唯一真源（布局 / 字号
// 阶梯 / 间距 / 状态点），颜色一律取宿主 --dsw-* 语义 token 或用 color-mix
// 派生（零裸色值），类名统一 dsh-my-skill-manager- 前缀。根容器不画面板
// 外框——设置面板 / 页签由宿主提供，这里只渲染内容列。
// 分片：tokens（变量与复位）/ chrome（命令条·筛选·工具条）/ deck（列表·
// 卡片·开关·详情）/ table（表格·批量条·状态页·诊断台·Toast·媒体查询）。
const STYLES: string = [STYLE_TOKENS, STYLE_CHROME, STYLE_DECK, STYLE_TABLE].join('\n')

const STYLE_TAG: string = 'data-dsh-my-skill-manager'
