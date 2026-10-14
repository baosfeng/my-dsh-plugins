# 00 需求澄清（前置必问，填完再进第 1 步）

platform: web                # DSH Web GUI 对话面
canvas: 1440x900             # 桌面主场景
frames: [browser-chrome]
responsive: yes
breakpoints: [1440, 1024, 768]     # 视口（页面架子）
container_breakpoints: [480, 380]  # **容器宽度**（本轮扩围）：插件可用宽度 = 消息列宽 ≠ 视口
min_supported: 768           # 桌面端产品，768 以下不管
dark_mode: optional          # 宿主有 data-ds-dark-theme 开关，本轮先做浅色，深色留细化轮
locale: zh-CN
deliverable: interactive-prototype
first_screen: 一条完整 AI 回答的渲染全景（markdown 元素 + 代码块胶囊 + mermaid 卡片 + 思考块）
fixed_constraints: 正文列不超过 760px；代码块长行横向滚动不软换行
notes: 参考 plugins/dsh-md-render 的自研视觉语言（--mdr-*）；风格基线取已注册的 user:deepseek-harness


## 范围（用户明确）
**只做 markdown 渲染**：即 dsh-md-render 自研 markdown 渲染器产出的元素（h1–h6 / p / 列表 / 任务列表 /
引用 / 表格 / 分隔线 / 行内 code / 链接 / 图片 / raw-HTML 转义 / 纯文本回落）及其元素状态。
**不碰**：宿主界面（会话列表 / 顶栏 / 侧栏）、代码块渲染、mermaid 图表卡片、思考块、上下文注入块的卡片外壳与控件。

## 范围扩围（本轮）
**新增覆盖**：卡片**工具条控件层** —— 代码块 banner、mermaid 卡片头、缩放条、「渲染为」语言选项的
**按钮形态**（默认只显示图标 + 悬停浮层文字）、**按容器宽度分档隐藏低频按钮**、以及头部换行排版。
**仍不碰**：卡片外壳（边框 / 圆角 / 阴影 / 内边距 / 底色）、图表引擎与交互行为（缩放数学 / 导出实现）。

扩围理由：用户口径「按钮只显示图标，hover 再显示文字」+「响应式与低分辨率下隐藏部分按钮」落在控件层，
而控件层此前不在样张范围内 —— 不纳入则本轮改动没有原型依据（= 回到「照感觉改」）。

## 响应式口径（本轮定稿）
插件可用宽度是**消息列宽**，与视口无关：大屏 + 侧栏展开时列可能只有 380px（视口断点判不到）；
反过来低分辨率的窗口里列自然变窄，容器查询同样命中。**故分档用 `@container`（容器查询），一条规则同管「大屏窄列」与「小屏」**；
`@media` 视口断点只留给页面架子，不用于控件分层。
