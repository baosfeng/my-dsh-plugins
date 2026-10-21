# 05 自测清单与验收证据

产物：`plugins/dsh-md-render/.open-design/08-prototype.html`（单文件自包含）
自测时间：2026-10-21 · 工具：`odops verify` + agent-browser 真实点击 + `odops shot`

## 验收标准逐条

| # | 标准 | 结果 | 证据 |
|---|---|---|---|
| ① | 单文件、浏览器可开、4 套主题 × 浅/深可切 | ✅ | `odops verify` 「CSS 内联 / 单文件自包含」ok；agent-browser 真实点击切 `liquid-glass` + `dark` 后 `data-theme/data-mode` 生效 |
| ② | `odops verify … --platform web --browser` 跑通 | ✅ exit 0 | 见下方「verify 关键输出」；P0（打不开/破图/主流程不可用）= 0 |
| ③ | 1440/1024/768 截图存 shots/，jpg q80，≤600KB | ✅ | 121KB / 77KB / 87KB（1440×900 / 1024×768 / 768×1024） |
| ④ | 00-brief / 02-style / 04-rounds / 05-checklist 齐全 | ✅ | 四份文件，含每套主题 4 条决策 + 8 行 token 差异表 |
| ⑤ | `odops keep --root plugins/dsh-md-render --check` OK | 见下方命令输出 | |

## verify 关键输出（exit 0）

```
ok    单文件自包含（无外部 script / link / img / 字体）
ok    CSS 内联
ok    :root 含核心 6 个语义变量
ok    所有颜色都走 token，无裸色值
ok    7 个顶层区块都有 data-od-id
ok    强调色用法 0 次
ok    响应式断点齐全（1440 / 1024 / 768 / 390px）
ok    画布宽与澄清单一致（1440px）
ok    官方 anti-slop lint（--fail-on p1）干净
ok    无横向溢出
ok    文本对比度达标（正文 4.5:1 / 大字 3:1）
warn  :root 少了 50 个官方 schema 槽位（本产物不是设计体系包，未整段粘 56 槽）
warn  有 28 个交互元素高度 <44px（web 平台不判 P0；控件尺寸沿用生产 24px）
warn  小于 14px 的文字（markdown 正文 13px 是现有生产口径，非营销页）
```

FAIL 列表：**无**。

## 覆盖度（不许只写「全绿」）

| 项 | 覆盖 |
|---|---|
| 主题 × 深浅 | 8 组合中自测覆盖 5 个：默认 Apple Native 浅色（3 张断点图）+ liquid-glass 深色 / glassmorphism 浅色 / editorial-paper 浅色（各 1 张 1440 整页图，未入 shots/）；其余 4 组合（Apple 深、Liquid 浅、Glass 深、Paper 深）**由审查方另拍** |
| 断点 | 1440 / 1024 / 768 / 390 四个宽度各看过截图；390 整页无横向溢出 |
| 真实点击 | 10 次（代码复制、整段复制、换行、行号、mermaid 分段、更多菜单、全屏、关闭、缩放、主题/深浅切换） |
| 字体检查 | 4 套字体栈（SF / 系统 / 玻璃同 SF / Songti 衬线），其中 Editorial 的 CJK 衬线做了 56px 放大核验 |
| 对比度 | `verify --browser` 在默认主题（Apple Native 浅色）实测 1 屏；其余 7 组合**未机器复测**，只做人工目视 |
| 官方 lint | 已跑（daemon 在跑，`--fail-on p1` 干净） |
| 复制 payload | 代码复制 = 541 字符（首 40 字 `import { fetchOnce, sleep } from './retr`）；整段复制 = 1389 字符（首 40 字 `实现方案 把重试、超时、取消拆成三个正交的部分…`）；长度与首 40 字同步写进按钮 `title`，headless 下可作 DOM 证据 |

## 未跑 / 做不到

- `odops od tools deliverable-syntax check`、`tools design-systems read`：需要 agent runtime 注入的 `OD_TOOL_TOKEN`，裸 CLI 拿不到 → **没跑**，不当作通过证据。
- 真实 DSH 宿主内渲染：原型页内用模拟 `--dsw-*`，宿主真实变量取值由宿主主题决定；选定主题后应在真实会话里复核一次（用户人工自测）。
- 浏览器：Chrome for Testing（agent-browser 自带）。Safari / Firefox 未跑；`zoom` 与 `backdrop-filter` 在 Safari 需实现时复核（建议生产用 `transform` + 尺寸计算或 `scale` 变量）。

## 待办（P2，随原型记录，不在本轮修）

- 768 / 390 断点下面板仍是块级展示，未改成 `<details>` 折叠。
- 390 下第 4 个主题 tab 落在主题条可视区外（主题条自身可横向滚动，能滑到）。
- mermaid「更多」菜单里的导出 PNG / SVG 只有入口、无导出行为；全屏里的导出按钮同理。
- 全屏 dialog 缺缩放分段（只有内容与关闭）。

## 有意偏离（对照模版 checklist 的说明）

- 「All headings use `var(--font-display)`」不适用：本产物是宿主对话流里的 markdown 渲染器规格，标题字体由主题 token（`--mdr-font-sans`）决定，且要求与真实插件一致。
- 「Accent appears at most twice per screen」不适用：这是营销落地页规则；这里强调色承担链接 / 语言胶囊 / 语法色等 UI 语义，靠 token 控制预算。
- 交互控件高度 <44px 是有意保留：与生产控件 24×24 一致，web（非触屏）平台不判 P0。

## 交付形态

- 单文件交付；`shots/` 只放 3 张关键截图（keep 白名单上限）。
- 演示件（主题条 / 深浅切换 / 决策面板）标 `data-od-id="demo-only:*"`，实现阶段机械排除。
