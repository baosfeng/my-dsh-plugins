# 发版前功能级验证清单 — dsh-md-render@0.2.0

验证时间：2026-09-20T20:56:20.279Z
验证环境：隔离实例（端口 3099，复用生产 profile 配置组合，独立 DSH_HOME）

## 自动验证项（verify-real-profile.mjs 自动执行）

- [x] 配置组合唯一性（dump-config 无重复插件行 id）
- [x] 实例启动就绪（HTTP 200）
- [x] 启动日志无 error / duplicate 记录
- [x] 插件 API 冒烟（--api-path 全部 200）

## 功能级验证项（需在隔离实例 + 真实浏览器中验证后勾选）

- [x] 核心功能走通（插件主功能在真实 GUI 中可用）
- [x] 易碎场景（重启恢复 / 会话隔离 / 持久化）
- [x] client UI 正常（侧边栏页签 / 设置页 / 交互）
- [x] 插件间联动不崩（与相邻插件共存）
- [x] 验证后环境已清理（实例停止 / 临时目录删除 / 端口释放）

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。

## 验证记录

验证者：验证+发版子 agent。环境：隔离实例端口 3099（独立 DSH_HOME，复刻生产 profile 配置组合 171 个 id），真实浏览器 Chrome for Testing（agent-browser，session `dsh-mdrender-verify`），真实模型 DeepSeek-V41-Flash。

### 头号假设（宿主 DOM 契约）—— 已证实

开发 agent 标注的假设「宿主渲染为 `div.md-code-block > pre.tzx-pre > code.language-text`」在真实环境**成立**：模型真实输出 ```text 围栏后浏览器实测该结构，`codeCls=language-text`、`preCls=tzx-pre`、插件容器 `hasMd=true`、按钮 `hasToggle=true`、`view=markdown`。

反例（一并记录）：模型用 **4 个反引号**（````text）时宿主**不产出** `md-code-block`（退化为 `p.tzx-p` 文本 + 内容按 markdown 渲染），该形态下插件不接管——属宿主围栏解析口径，非插件缺陷。

### 七条用例

| # | 用例 | 判定 | 证据 |
| - | ---- | ---- | ---- |
| 1 | ```text 块内 markdown 渲染 | **通过** | 标准写法实测：`<h1>一级标题</h1>`、`<ul class="tzx-ul"><li>列表项一</li>…`、`<p class="tzx-p">这是一个含 <strong>加粗词</strong> 的段落。</p>`、`<p class="tzx-p"><a href="https://example.com" target="_blank" rel="noreferrer">示例链接</a></p>`、`<table class="dsh-md-render-table">`；断言 hasH1/hasUl/hasTable/hasStrong/hasA 全 true |
| 2 | plaintext / txt 同样生效 | **通过** | 同会话实测：`language-plaintext`（hasMd=true, hasToggle=true）、`language-txt`（hasMd=true, hasToggle=true） |
| 3 | 每块独立「查看原文」切换 | **通过** | 点击前 view=markdown / 文案「查看原文」/ aria-pressed=false / md:flex / pre:none → 点击后 view=source / 「查看渲染」/ true / md:none / pre:block；原文 `pre` 文本 `hello world` 未被二次渲染；同会话另一块保持自身状态（逐块独立） |
| 4 | 其他标记与无标记块行为不变 | **通过** | `language-js` / `language-json` / 无标记三块均 hasMd=false、hasToggle=false、无 view 属性、无签名属性；js 块高亮 token 仍为 `keyword:"const"`、`number:"1"`（data-theme=github-light） |
| 5 | 流式输出不闪断/不重复 | **通过** | 100ms 采样器时间序列：dt=1.6s `[data-streaming]=1` 且 blocks 10→11 **而 textMd/toggles 保持 7**（流式门控生效）；dt=2.1s streaming=0 时 textMd/toggles 一次性 7→8；maxTextMd==maxToggles==8（无重复挂载）、toggleDrops=0（无回落/重建） |
| 6 | 既有能力无回归 | **通过** | 表格：`table.dsh-md-render-table` + 排序表头 + 横向滚动提示；代码高亮 token span 正常；复制按钮：9 个 md-code-block 内 9 个 `button.dsh-md-render-copy`、text 块内 1 个；console 未捕获错误 0（`agent-browser errors --json` 返回空） |
| 7 | 思考模式 | **部分验证（不阻断）** | 实现只依赖 `div.md-code-block` + `code.language-*`，与 README「思考模式契约相同则生效、契约不同保持原样」逐字一致（`src/client/parts/text-markdown.ts` 的 textFenceLang）；但思考内容不可控，未能构造思考区内的 text 围栏块，未在真实环境直接观察到思考区接管 |

### 其他环境说明

- **环境缺口（非插件缺陷）**：隔离实例自生成的 `.credentials.yaml` 缺 `refs:`（provider key 映射）、`settings.yaml` 未含 provider 段，首轮真实模型调用报 `MISSING_CREDENTIAL`。按 skill「先查这里再查插件代码」判定为环境问题，补齐生产凭据并重启实例后恢复正常（真实模型正常产出）。隔离实例重启后会话历史保留、插件接管状态保留（易碎场景）。
- **边界观察（非本次回归）**：加粗/链接与表格**无空行紧邻**时，`renderTable` 把表格前文本以 `p.textContent` 原样输出（`p.dsh-md-render-prefix`），行内 `**加粗**` / `[链接]()` 保持字面。该函数属 `render.ts` 既有 #205 实现（本次改动文件不含 render.ts），标准写法（空行分隔）下不受影响。
- **新增效果图** `assets/text-fence-markdown.png` 取自本实例真实截图（1280×577），前景元素经 DOM 断言全部在视口内（`text` 语言标签、切换按钮、h1/ul/strong/a/table 均为 IN）。
