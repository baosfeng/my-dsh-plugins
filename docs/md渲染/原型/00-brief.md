# 00 需求澄清（前置必问，填完再进第 1 步）

platform: web                # DSH Web GUI 对话面
canvas: 1440x900             # 桌面主场景
frames: [browser-chrome]
responsive: yes
breakpoints: [1440, 1024, 768]
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
