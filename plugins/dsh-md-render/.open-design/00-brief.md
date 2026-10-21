# 00 需求澄清 · dsh-md-render 主题换新（4 套候选对照页）

platform: web
canvas: 1440x900
frames: [browser-chrome]
style: custom — 4 套候选主题（apple-native / liquid-glass / glassmorphism / editorial-paper），由用户选定 1 套后再落生产
responsive: yes
breakpoints: [1440, 1024, 768, 390]
min_supported: 390
dark_mode: required
locale: zh-CN
deliverable: interactive-prototype
first_screen: 顶部主题切换条 + 一条真实 markdown 回答（思考块 / 正文 / 表格 / mermaid 卡 / 代码卡 / 上下文块），浅色深色可切
fixed_constraints: 宿主 DSH Web 对话流里的 markdown 内容，单栏正文宽约 860px；控件尺寸沿用现状（图标按钮 24×24、正文 13px/1.72）
notes: 用户原话「优化一下当前的 markdown 渲染引擎主题，换一套新的，我比较喜欢 Apple 风格、玻璃风格等，但是你最好是出原型我来选」

## 用户原话 / 已拍板

- 用户原话：「优化一下当前的 markdown 渲染引擎主题，换一套新的，我比较喜欢 Apple 风格、玻璃风格等，但是你最好是出原型我来选」。
- 已拍板：本次只出原型（可点对照页），**不改生产样式**；用户选定后再由 leader 派实现。
- 已拍板（leader 派发口径）：4 套方向固定 —— Apple Native / Liquid Glass / Glassmorphism / Editorial Paper。

## leader 推断（待用户确认）

- [推断] 交付形态 = 单文件交互原型，4 套主题共用同一份真实 DOM，只切根节点 dataset（便于后续把主题 CSS 直接搬进 styles-*.ts）。
- [推断] 主题切换控件、决策面板属于演示件（demo-only），不进入生产。
- [推断] 生产落地优先复用现有 `--mdr-*` token；确实表达不了的材质差异再引入少量新 token（见 02-style.md 的 token 差异表）。

## 断点取舍表（写 CSS 前先定）

| 断点 | 保留 | 收起 | 隐藏 |
|---|---|---|---|
| 大 1440 | 全部：主题条 + 决策面板 + 正文全宽 | — | — |
| 中 1024 | 主题条 + 正文；决策面板移到正文之后 | 决策表格 → 两列压缩 | 主题条副标题 |
| 小 768 | 主题条（名称）+ 正文 | 决策面板 → 折叠为 `<details>`；mermaid 工具条允许横向滚动 | 主题描述句 |
| 最小 390 | 主题名称分段 + 正文主流程 | 决策面板 → details；代码卡保持横向滚动 | 主题描述句、页脚说明 |

## 主题对照对象（固定 4 套）

| # | 主题 id | 一句话定位 | 深浅 |
|---|---|---|---|
| 1 | apple-native | macOS/iOS 原生：系统灰阶、SF 字体栈、8–10px 圆角、极细描边、克制阴影 | 各一套 |
| 2 | liquid-glass | Apple 26 液态玻璃：半透明材质 + backdrop-filter + 高光内描边 + 柔和光晕 | 各一套 |
| 3 | glassmorphism | 重玻璃：大模糊、渐变底衬、明显半透明卡片层叠 | 各一套 |
| 4 | editorial-paper | 对照方向：暖白纸感、衬线标题、低饱和、强呼吸感 | 各一套 |
