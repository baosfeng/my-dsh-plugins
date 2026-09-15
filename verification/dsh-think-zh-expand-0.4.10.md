# 发版前功能级验证清单 — dsh-think-zh-expand@0.4.10

验证时间：2026-09-15T13:10:21.446Z
验证环境：隔离实例（端口 3092，复用生产 profile 配置组合，独立 DSH_HOME）

## 自动验证项（verify-real-profile.mjs 自动执行）

- [x] 配置组合唯一性（dump-config 无重复插件行 id）
- [x] 实例启动就绪（HTTP 200）
- [x] 启动日志无 error / duplicate 记录
- [x] 插件 API 冒烟（--api-path 全部 200）
- [x] external 缺包演练：隔离实例 node_modules 不含 dsh-md-render（启动日志无相关错误）

## 功能级验证项（需在隔离实例 + 真实浏览器中验证后勾选）

- [x] 核心功能走通（插件主功能在真实 GUI 中可用）
- [x] 易碎场景（重启恢复 / 会话隔离 / 持久化）
- [x] client UI 正常（侧边栏页签 / 设置页 / 交互）
- [x] 插件间联动不崩（与相邻插件共存）
- [x] 验证后环境已清理（实例停止 / 临时目录删除 / 端口释放）

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。

## 验证记录（真实环境证据，2026-09-15）

**验证方式**：`node scripts/verify-real-profile.mjs --addons plugins/dsh-think-zh-expand --port 3092 --clean-externals --workspace /tmp/dsh-think-verify/ws --checklist verification/dsh-think-zh-expand-0.4.10.md --plugin dsh-think-zh-expand --version 0.4.10`（复刻生产 profile 组合，`--clean-externals` 剔除 `dsh-md-render`），
再向隔离 `DSH_HOME` 注入生产 `settings.yaml` + `.credentials.yaml`（refs 段）以做**真实模型会话**验证。

**缺包证据**：`[verify] ✓ 缺包演练生效：隔离实例 node_modules 不含 dsh-md-render`；
`profiles/web/node_modules/dsh-md-render` → No such file or directory；
`package.json` 中 `dsh-md-render` 出现 0 次（bundles/dependencies 均已剔除）。

**核心功能（真实 reasoning，非合成 DOM）**：隔离实例 GUI 内真实会话（模型 DeepSeek-V41-Flash / 推理等级 High）触发 reasoning，
think 插件渲染出 3 个 `.dsh-think-zh-expand-assistant` 块：
`{"assistant":3,"thinkBlocks":3,"tables":2,"katex":3,"fallbackPre":0}`；
表格 DOM：`<table><thead><tr><th>项目</th><th>值</th></tr></thead><tbody><tr><td>幻和</td><td>15</td></tr></tbody></table>`。

**哪一级生效（鉴别）**：第二级（平台 `MarkdownText`）——
① 环境无 `dsh-md-render`（上）；② DOM 中 md-render 特征类为 0（`.tzx-md` / `.dsh-md-render-table-scroll`）；
③ 渲染根类为 `_markdown_kcgor_5`（= 平台 `@deepseek-ai/dsh-client-ui-primitives.MarkdownText` 的 CSS module 类，2026-09-15 独立实测确认）；
④ 第三级 `<pre data-dsh-think-zh-expand-fallback>` 计数 0。

**对照（假降级复现）**：把隔离 `node_modules/dsh-think-zh-expand` 换回 `0cbb5c6`（#293 修复前的 0.4.9 假降级版，`MarkdownView = null` 后仍 `createElement(null)`），
重启后打开同一会话：console 出现 12 次 `Minified React error #130`（React error #130 的完整文案即
`Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: null`）
与 3 次 `slot entry crashed in 'conversation.chat.node'`；`.dsh-think-zh-expand-assistant` 渲染数 = 0（思考块整块消失）。

**易碎场景**：实例重启（3092 → 3091 → 3090）后同一历史会话回读一致，实验组下重新渲染仍为
`{"assistant":3,"tables":2,"katex":3}`。

**client UI 交互**：点击 `.dsh-think-zh-expand-think-head` → `aria-expanded` 由 `true` 变 `false`，收起态显示首行摘要；
本页 console `Element type is invalid` / `Minified React error` = 0 条。

**插件间联动**：隔离实例复刻生产组合（dump-config 171 个 id 无重复、21 个第三方插件共存），启动日志无 error/duplicate。

**回归（新 main）**：`dsh-mermaid-render`（#301 修复后）实例正常启动，`GET /mermaid-render/assets/mermaid-10.9.3.min.js` → 200
（`application/javascript; charset=utf-8`，3336760 B）。

**未覆盖项（如实记录）**：① 未做"装了 `dsh-md-render` 时行为与 0.4.9 逐字节一致"的对照（时间盒内未做，`--clean-externals` 只覆盖缺包场景）；
② 对照组使用的是 `0cbb5c6`（#293 修复前）而非 0.4.9 发布 tag 的确切产物，两者同为"假降级"实现。

截图：`/tmp/dsh-think-verify/artifacts/{fix-3092.png, fix-3090-reloaded.png, control-3091.png}`
原始 console：`/tmp/dsh-think-verify/artifacts/{fix-console.txt, control-console.txt}`
