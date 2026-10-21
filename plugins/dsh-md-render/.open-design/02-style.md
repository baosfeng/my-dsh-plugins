# 02 风格：4 套候选主题的设计决策与 token 差异

> 阶段 2 产物（本任务 = 主题选型对照，不新建设计体系包；每套候选都用**现有 `--mdr-*` token 名**表达，
> 供用户选定后直接搬进 `src/client/parts/styles-*.ts`）。
> 机器契约：`08-prototype.html` 里 4 套主题共用同一份真实 DOM，只切 `<html data-theme>` / `data-mode`；
> 主题 CSS 只做 token 覆写（`color-mix()` / alpha / `backdrop-filter`），**不写裸色值**。
> 页内模拟的 `--dsw-*` 是宿主语义变量的替身（真实运行时由 DSH 注入）。

## 0. 分层与判据

```
宿主 --dsw-*（页面顶部 :root 模拟，浅/深各一套）
      ↓ 转发
插件 --mdr-*（与 styles-base.ts 同名同义；26 色 + 几何 + 字号 + 间距 + 动效）
      ↓ 主题覆写（html[data-theme] :is(.mdr-root,.mdr-md)）
四套候选：apple-native / liquid-glass / glassmorphism / editorial-paper
```

- **颜色纪律**：主题层只用 `color-mix(in srgb, var(--dsw-*) …, transparent)` 派生，零裸十六进制；测试 `test/mdr-styles.mjs` 的口径不变。
- **不改结构**：四套主题的 markdown/围栏/mermaid/ctx/think 结构与类名完全一致，差异只在 token 取值与少量材质声明（`backdrop-filter` / `box-shadow`）。
- **深色**：每套都只换绑 `--dsw-*` 与同义 token，不新增第二套颜色常量。

## 1. Apple Native（推荐基线）

**定位**：macOS / iOS 原生 —— 系统灰阶层级、SF 字体栈、8–10px 圆角、极细描边、克制阴影、无花哨装饰。

**设计决策**

1. 层级用系统灰阶表达（`bg-layer-2` 承托代码卡 / 表格 / mermaid），不使用半透明材质，玻璃效果一律不出现。
2. 描边降到 label 的 8–13% 透明度，接近 macOS 发丝线；阴影只保留 1px 级（`0 1px 1px 4%`）。
3. 圆角收敛到 5 / 8 / 10 三档（控件 6px），标题字距 -0.015em，接近 SF Display 的字面感。
4. 引用区用中性浅底 + 22% 灰线；强调色只留给链接、语言胶囊、语法关键字。

**关键 token 差异（相对当前生产默认）**

| token | 取值 | 效果 |
|---|---|---|
| `--mdr-surface` | `--dsw-alias-bg-layer-2` | 实心卡片，不上模糊 |
| `--mdr-border` | label 13% | 发丝描边 |
| `--mdr-radius-sm/md/lg` | 5 / 8 / 10 | 系统圆角 |
| `--mdr-card-shadow` | 1px 4% | 几乎不可见 |
| `--mdr-font-sans` | SF Pro Text / PingFang SC | 原生字面 |
| `--mdr-quote-bg` | label 3% | 中性引用 |
| `--mdr-table-head-bg` | `bg-layer-2` | 中性表头 |
| `--mdr-frame-head-bg` | `bg-layer-2` | 代码卡头与卡同层 |

**生产落地**：纯 token 改值（styles-base.ts 的几何 + styles-markdown.ts 的 surface/border 引用不动），零结构性改动，风险最低。

## 2. Liquid Glass

**定位**：Apple 26 液态玻璃 —— 半透明材质 + `backdrop-filter` 模糊 + 高光内描边 + 柔和光晕，控件像浮在内容之上。

**设计决策**

1. 卡片材质 = 代码底 62–66% 不透明度 + `blur(22px) saturate(180%)`；正文仍压在偏实色的层上，保证长文可读。
2. 顶部 1px 内高光（label 12–18%）制造玻璃边，外部只有一层 12px/32px 柔和投影。
3. 圆角提升到 6 / 12 / 14，控件 6–7px，接近 iOS 26 的连续圆角观感。
4. 引用底改强调色 10%（比默认 14% 更低饱和），避免玻璃上出现色块。

**关键 token 差异**

| token | 取值 | 效果 |
|---|---|---|
| `--mdr-surface` | code 66%（深色 62%） | 半透明材质 |
| `--mdr-material` | `blur(22px) saturate(180%)` | 背景透出 |
| `--mdr-border` | label 15% | 弱描边 |
| `--mdr-card-shadow` | `0 12px 32px` 10% + `inset 0 1px 0` 12% | 浮起 + 内高光 |
| `--mdr-radius-sm/md/lg` | 6 / 12 / 14 | 连续圆角 |
| `--mdr-quote-bg` | accent 10% | 低饱和色底 |
| `--mdr-table-head-bg` | layer-1 40% | 玻璃表头 |
| `--mdr-frame-head-bg` | layer-1 34% | 卡头玻璃层 |

**深色注意**：深色下 `--mdr-surface` 提到 62% 并把内高光提到 18%，否则暗底玻璃会「糊成一块」。文字仍用 label-secondary，未降低对比度。

## 3. Glassmorphism

**定位**：重玻璃 —— 大模糊、渐变底衬、明显半透明卡片层叠，视觉更张扬（**刻意偏离 Apple 克制路线**，用于对比"玻璃到底能走多远"）。

**设计决策**

1. 材质 54–58% 不透明度 + `blur(34px) saturate(200%)`，让页底渐变光斑成为构图的一部分。
2. 阴影放大到 `0 24px 60px` 16%（深色 30%），卡片之间形成明显的前后层叠。
3. 圆角全线上调（8 / 16 / 18），边框 13–20%，玻璃轮廓更清楚。
4. 强调色用量最高：引用底 16%、表头用 layer-1 34% 混色，视觉重心偏「展示」。

**关键 token 差异**

| token | 取值 | 效果 |
|---|---|---|
| `--mdr-surface` | code 58%（深色 54%） | 强半透明 |
| `--mdr-material` | `blur(34px) saturate(200%)` | 大模糊 |
| `--mdr-border` | label 20% | 清晰玻璃边 |
| `--mdr-card-shadow` | `0 24px 60px` 16%（深色 30%） | 强层叠 |
| `--mdr-radius-sm/md/lg` | 8 / 16 / 18 | 大圆角 |
| `--mdr-quote-bg` | accent 16% | 明显色块 |
| `--mdr-table-head-bg` | layer-1 34% | 玻璃表头 |

**可读性红线**：初版 48% 不透明度在浅色下被背景光斑洗白（代码卡对比度下降），已调到 58% 并把背景光斑 opacity 从 0.95 降到 0.7。**落地时 `--mdr-surface` 不低于 54%**。

## 4. Editorial Paper（对照方向）

**定位**：暖白纸感、衬线标题、低饱和、强呼吸感 —— 用于对比"非 Apple"路线，检验用户是否其实想要阅读型界面。

**设计决策**

1. 底色用 warn 色 4–6% 混入 `bg-layer-1` 得到暖纸感（不引入任何新色值）。
2. 标题与正文切换衬线字体栈（Songti SC / Noto Serif CJK SC / ui-serif / New York / Georgia），行距与段间距拉到 14px。
3. 圆角压到 2 / 3 / 4，去掉阴影与模糊，靠留白与细线分区。
4. 强调色与正文混色降低饱和度（62–70%），引用底改暖色 8%。

**关键 token 差异**

| token | 取值 | 效果 |
|---|---|---|
| `--mdr-bg` / `--mdr-surface` | warn 5–6% | 暖纸底 |
| `--mdr-font-sans` | Songti SC / ui-serif | 衬线 |
| `--mdr-radius-sm/md/lg` | 2 / 3 / 4 | 近直角 |
| `--mdr-card-shadow` | none | 无阴影 |
| `--mdr-material` | none | 无模糊 |
| `--mdr-body-gap` | 14px | 强呼吸 |
| `--mdr-table-head-bg` | transparent | 无线表头 |
| `--mdr-accent` | accent 62% + label | 低饱和强调 |

**实测注意**：Chromium 里 `ui-serif` 对中文不生效，必须把 `"Songti SC"` / `"Noto Serif CJK SC"` 放在字体栈**最前**，否则中文仍是 sans（本原型已踩过并修正）。

## 5. 生产落地：需要新增的 token（四套共用）

现有 token 已能表达 80% 的差异；以下 12 个建议加在 `styles-base.ts` 的 `.mdr-root,.mdr-md` token 块（都有默认值，未选主题时行为不变）：

| 新 token | 默认值 | 用在哪 |
|---|---|---|
| `--mdr-font-sans` | 现有 sans 栈 | `.mdr-md` / 围栏标题 / mermaid 文字 |
| `--mdr-font-mono` | `ui-monospace, 'SF Mono', Menlo…` | 行内码 / 围栏 / mermaid 代码 |
| `--mdr-material` | `none` | `.mdr-fence` / `.mdr-mm-card` / `.mdr-md-table-wrap` / `.mdr-ctx` 的 `backdrop-filter` |
| `--mdr-card-shadow` | `none` | 同上卡片的 `box-shadow` |
| `--mdr-hairline` | `var(--mdr-border-soft)` | 思考块 / 次级分隔 |
| `--mdr-heading-weight` | `600` | h1–h6 |
| `--mdr-heading-tracking` | `-.01em` | h1–h6 |
| `--mdr-body-gap` | `10px` | `.mdr-md` 的 `gap` |
| `--mdr-quote-bg` | `var(--mdr-accent-soft)` | blockquote 底 |
| `--mdr-quote-border` | `var(--mdr-accent)` | blockquote 左线 |
| `--mdr-table-head-bg` | `var(--mdr-bg-elevated)` | `th` 背景 |
| `--mdr-frame-head-bg` | `color-mix(surface-raised 70%, surface)` | `.mdr-fence-head` 背景 |

- 若只选 Apple Native：以上多数可保持默认，实际改动 ≈ 6 行（radius / border / shadow / quote / table-head / font）。
- 若选玻璃系：`backdrop-filter` 要加在 **卡片容器**（`.mdr-fence` / `.mdr-mm-card` / `.mdr-md-table-wrap` / `.mdr-ctx`），并注意 `overflow:hidden` 的卡片内部不要再叠模糊（性能）。
- 若选 Editorial：字体栈注意 CJK 顺序（见 §4 实测注意），并确认 Windows / Linux 回退到 `serif` 后仍可读。

## 6. 对比口径（给用户挑用）

| 场景 | 更合适 | 原因 |
|---|---|---|
| 深色为主 | Apple Native / Liquid Glass | 实色或高不透明度材质，暗底不发灰 |
| 长文阅读 | Apple Native / Editorial Paper | 无模糊干扰，行距稳定 |
| 代码密集 | Apple Native / Liquid Glass | 代码卡与背景分离清楚，语法色对比足 |
| 想要"新"的观感 | Liquid Glass | Apple 26 风格最贴近用户诉求，且不牺牲可读性 |
| 视觉冲击 / 展示 | Glassmorphism | 层叠与光斑最抢眼，但日常阅读负担最大 |
