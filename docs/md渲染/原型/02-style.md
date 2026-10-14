# 02 风格选择（R1 后更新）

style: apple                     # 官方内置风格包（iOS / macOS / Apple 官网视觉语言）
来源: 用户指定（原选 user:deepseek-harness，R1 起按用户要求改参考 Apple 风格）
理由: 用户要求"参考 Apple 设计风格继续优化"；apple 是官方 56 槽完整包，语义色 / 排版 / 胶囊几何 / 克制用色都齐。

## DESIGN.md 要点（apple 包）
- 气质: 精确、克制、产品优先；深度靠明度差与发丝边，不靠阴影
- 颜色: 单一蓝色强调族（动作 #0071e3 / 链接 #0066cc / 深底亮链 #2997ff）；白画布 + 淡苹果灰 #f5f5f7 表面
- 文字: Near-Black Ink #1d1d1f 主文字，Secondary Neutral #6e6e73 次级，Soft Border #d2d2d7 / #e8e8ed 发丝
- 字体: SF Pro Display 走标题、SF Pro Text 走正文/控件；字重 600 为主，700 只用于强调
- 几何: **胶囊是签名动作语言**（18–980px），主操作 8px 圆角 + 紧凑内边距（8px 15px）
- 深度: 极少；卡片发丝边 + 极轻阴影；按压用轻微缩放/换填色确认
- 排版: 标题紧字距（--tracking-display -0.015em），正文 17px

## md-render 自研视觉语言（保留，改由 apple token 表达）
- 强调胶囊：语言名 / 卡片标题（大写 + 0.08em 字距）→ 用 apple 的 pill 半径 980px
- 强调竖条：代码卡左 3px、md 卡左 2px、h1 左 3px、引用块左 3px → 走派生线索色（55% 强调）
- 排版尺度：改用 apple 的 --text-* 阶梯（h1 = --text-lg 21 / h2 = --text-base 17 / 正文 17 / 代码 --text-xs 12）
- 控件：统一胶囊 chip（28px 高）+ 主操作实心蓝；focus 用 apple 的 4px 光晕

## token 变量表
R1 起把 `odops style apple --tokens` 的 :root **整段 56 槽逐字粘进** 04-design.html 第一个 <style>；
产物本地只追加 5 个派生线索色（--mdr-line-accent / --mdr-tint-accent / --mdr-accent-text / --mdr-code-bg / --hairline），不改风格契约。

## 两处有意偏离（记在这里，别让后人当 bug）
1. **中文正文行高 1.6**：apple 的 --leading-body 是 1.47（为拉丁 UI 调的），中文长回答按 1.47 偏挤；
   行高是本产物的本地取值，若要固化应写进"项目自有风格包"而不是改 apple 包。
2. **原始 --accent 只留 2 处可见用法**（主操作按钮 + 已勾选任务框），其余强调线索一律走派生色：
   apple 的规则是"单一蓝色族只给 action / link"，而 md-render 原语言处处用强调色 —— 折中结果见产物。


## 范围收窄（用户明确）
风格只作用在 **markdown 内容本身**（.md 作用域内的元素与状态）。
宿主 chrome 与其他渲染器（代码块 / 图表 / 思考块）的样式不在本样张内 —— 之前 R1–R3 画的会话三栏、
卡片头控件、状态清单里属于那些功能的部分，已从交付版移除（保留在 history 里）。
