> **定稿**：本 brief 对应原型 [dsh-my-skill-manager.html](dsh-my-skill-manager.html)，用户已于 2026-10-24 验收通过并开始实施。

# brief v3 · Skill 管理重构（零旧基线）

> 唯一输入：功能清单 + 宿主承载约束 + 示例数据。**禁止**读 `docs/原型重构/设计基线.md`、禁止参考 `.open-design/03-layouts/skill-manager-a|b.html`、禁止参考 `plugins/dsh-my-skill-manager` 现有界面。
> 产品形态：DSH「设置 → 插件 → Skill 管理」页签，可用内容区 564×约 620px。

## 一、为什么重来

旧两版套用了旧原型的视觉与结构基线（列表行 + 开关 + 分段控件 + 场景胶囊），本质是改版不是重构。本版要求：**功能等价，界面重新设计**，旧原型里的任何布局元素都不作为默认答案。

## 二、设计概念：「技能台（Skill Deck）」

把 skill 当作「能力资产」来管，而不是配置项列表：

1. **命令条**（顶部一条）：搜索（⌘K）+ 概览数字（全部 / 启用 / 禁用 / 异常）+ 异常入口 + 重新扫描。
2. **两种视图**（一个开关切换，筛选状态共享）：
   - **卡片流**（默认）：按来源分组（本项目 / 用户 / 内置 / 异常），粘性分组头；每张卡 = 左侧状态竖条（启用绿 / 禁用灰 / 异常橙）+ 名称 + 来源点 + 一行描述 + **双作用域开关（全局 / 本项目）** + 使用热度（次数 + 最近）+ 展开箭头。
   - **紧凑表**：表头可排序（名称 / 来源 / 状态 / 使用 / 最近），行高 32，多选 + 行内双开关。
3. **双作用域开关**：不再用「全局 / 本项目」视图切换。每个 skill 直接并排两个开关：全局（所有项目）与本项目（仅当前项目）。全局关 → 两处视觉降级；仅本项目关 → 项目开关变 warn。未收录 → 两个开关禁用 + 异常标记。
4. **焦点详情**：点卡片/行，该卡原地展开为两列详情面板：左列描述全文、路径（复制）、provider、调用能力（模型可调用 / 用户可调用）、来源；右列 SKILL.md 只读预览（等宽，前 15 行，复制全文）+ 使用统计（次数 / 最近 / 来源）。
5. **选择模式**：勾选后命令条变操作条（已选 N / 启用 / 禁用 / 退出）；批量禁用内联二次确认。
6. **诊断视图**：点「异常 N」整页切换为诊断台（异常条目：名称 / 路径 / 原因 / 建议 / 复制路径），可返回。
7. **原型演示工具**（不是产品功能）：右上角「演示」下拉切 默认 / 搜索 / 批量 / 诊断 / 空态；主题切换。

## 三、功能清单（验收）

- [ ] F1 承载：设置面板 800×800、导航 188px、「插件」二级 tab 行、内容 564px；深浅主题。
- [ ] F2 命令条：搜索（⌘K 聚焦、Esc 清空）、概览 4 数字可点筛选、异常入口带计数、重新扫描（loading + 时间）。
- [ ] F3 视图切换：卡片流 / 紧凑表，切换保留搜索、筛选与展开状态。
- [ ] F4 卡片流：来源分组 + 粘性头 + 计数；卡片含状态竖条、名称、来源点、单行描述、双开关、热度、展开箭头。
- [ ] F5 双作用域：至少演示 4 种状态——都启用 / 仅全局禁用 / 仅本项目禁用 / 未收录（双禁用 + 异常）。
- [ ] F6 紧凑表：排序表头 + 多选 + 行内双开关 + 行点击展开。
- [ ] F7 焦点详情：两列（左信息 / 右预览 + 统计）；复制路径 / 复制全文。
- [ ] F8 单行启停：即时 + toast；某一行首次失败显示内联错误 + 重试成功。
- [ ] F9 选择模式：已选 N / 启用 / 禁用（内联确认）/ 退出。
- [ ] F10 诊断视图：≥2 条异常（坏符号链接 / 缺 SKILL.md），路径可复制，可返回。
- [ ] F11 筛选：来源 chips、状态 chips、只看未使用（可叠加）。
- [ ] F12 排序：名称 / 使用次数 / 最近 / 来源（卡片流用下拉，表格用表头）。
- [ ] F13 空态：无数据 / 搜索无结果 / 无项目上下文（本项目开关禁用 + 提示）。
- [ ] F14 加载 / 加载失败（带重试）。
- [ ] F15 无障碍：开关 role=switch + aria-checked、图标按钮 aria-label、focus-visible、Esc。
- [ ] F16 演示工具：右上角「演示」下拉 + 主题切换；切换 200ms 淡入；prefers-reduced-motion 关闭。

## 四、数据（真实样本）

项目来源（project-dsh，10）：development-lifecycle、dsh-github-triage、dsh-plugin-development、plugin-release、plugin-runtime-debug、plugin-test、plugin-upgrade、plugin-write、resource-budget-review、verifying-dsh-plugins。
用户来源（user-agents，13）：agent-browser、brainstorming、codebase-memory、crafting-code、github-ops、leader-ops、npm-ops、open-design、quality-gates、ssh-ops、systematic-debugging、writing-plans、writing-skills。
内置（bundled，2）：web-search、image-gen。
异常（2）：old-skill（坏符号链接）、draft-skill（缺 SKILL.md）。
使用统计：leader-ops 42 次（10-24 16:02，model）、open-design 17、quality-gates 9、github-ops 6、其余 0。
项目根：/Users/bsfeng/IdeaProjects/my-dsh-plugins。

## 五、视觉与工程约束

- 单文件自包含 HTML；无 CDN / 外链 / 字体图标；图标内联 SVG（stroke 1.8，viewBox 24）。
- 颜色集中在一处 `:root` token（`--sk-*`），:root 之外零裸色值；补官方核心 6 槽别名 `--bg/--surface/--fg/--muted/--border/--accent`；顶层区块加 `data-od-id`。
- 画布 1440×900 模拟窗口；设置面板 800×800 居中；断点 1024 / 768 收窄。
- 文案中文；类名前缀 `sk-`；字体栈 -apple-system / PingFang SC。
- 视觉方向：工程工具的克制感 —— 深色为默认，低饱和表面、1px hairline、状态色只用于竖条与徽标；卡片圆角 10；不用渐变与玻璃拟态；动效只做 transform/opacity。
- 不实现真实后端；点击给前端反馈。