# 发版前功能级验证清单 — dsh-file-activity@0.5.8

验证时间：2026-09-13T08:11:13.207Z（实例启动；功能级验证于 2026-09-13 16:11–16:26 CST 完成）
验证环境：隔离实例（端口 3106，复用生产 profile 配置组合，独立 DSH_HOME=/tmp/dsh-verify-real-3106）+ agent-browser（Chrome for Testing，独立 session fa3106）

## 自动验证项（verify-real-profile.mjs 自动执行）

- [x] 配置组合唯一性（dump-config 无重复插件行 id）
- [x] 实例启动就绪（HTTP 200）
- [x] 启动日志无 error / duplicate 记录
- [x] 插件 API 冒烟（--api-path 全部 200）

## 功能级验证项（需在隔离实例 + 真实浏览器中验证后勾选）

- [ ] 核心功能走通（插件主功能在真实 GUI 中可用）
- [x] 易碎场景（重启恢复 / 会话隔离 / 持久化）
- [ ] client UI 正常（侧边栏页签 / 设置页 / 交互）
- [x] 插件间联动不崩（与相邻插件共存）
- [x] 验证后环境已清理（实例停止 / 临时目录删除 / 端口释放）

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。
> **本次结论：不通过**（核心功能、client UI 两项未勾选，见下方证据 A/B/C）。`--check` 应 exit 1。

## 验证记录（dsh-file-activity@0.5.8，端口 3106）

### 0. 实例与前置（issue #220 / #240）

```bash
node scripts/verify-real-profile.mjs --addons plugins/dsh-file-activity --port 3106 --keep \
  --workspace /Users/bsfeng/IdeaProjects/my-dsh-plugins \
  --checklist verification/dsh-file-activity-0.5.8.md --plugin dsh-file-activity --version 0.5.8
```

- 脚本 exit 0；`dump-config` **172 个 id 无重复**；`dsh-file-activity → /Users/bsfeng/IdeaProjects/my-dsh-plugins/plugins/dsh-file-activity ✓`（realpath == 本仓库待验插件，非主工作区旧版）
- `--workspace` 预置成功（`storages/workspace.json`，GUI 显示工作区 `my-dsh-plugins`，合成器可用）
- 环境前置 1（真实模型）：`cp ~/.dsh/settings.yaml /tmp/dsh-verify-real-3106/settings.yaml` + 合并生产 `.credentials.yaml` 的 `refs` 段（DEEPSEEK/XIAOMI_TOKEN_PLAN_CN/OPENCODE_GO_API_KEY）→ 手工重启实例。**验证有效**：GUI 内真实模型 `opencode-go/deepseek-flash` 完成一轮 1 轮 2 步工具调用（28.5K tok），未弹「添加 API Key」
- 环境前置 2（issue #240 禁用名单）：`/tmp/dsh-verify-real-3106/profiles/web/cordis.patch.yml` 的 `disabled: true` 仅 my-context / task-reliability / ts-example / guardian / observability / session-title-gen，**不含 file-activity** ✓（脚本亦已剥离 `.dsh-market`）
- 重启后 token 变更：`dsh-web.log` 追加新 `?token=` 行，须取最后一行（旧 token 401）

### 1. 核心功能（**不通过**，证据 A）

真实数据链路（后端）**成立**，GUI 呈现链路（前端）**断开**：

- 真实 agent 工具调用（GUI 发消息，真实模型）：`read .verify-tmp-3106/readme.txt` → `write .verify-tmp-3106/created-by-agent.txt` → `edit .verify-tmp-3106/readme.txt`（工作区文件确实被改写：readme.txt=`hello file-activity 0.5.8 verification EDITED`）
- 落盘 `$DSH_HOME/file-activity.json`（JSON Lines）记录正确：
  `session-23b163d7-… | readme.txt | read`、`created-by-agent.txt | write`、`readme.txt | edit`、`readme.txt | read`
- `GET /file-activity/api/stats?sessionId=session-23b163d7-…` → 200：
  `recent=[readme.txt:read, created-by-agent.txt:create]`；`counts={readme.txt:{read:2,modify:1}, created-by-agent.txt:{create:1}}`（read/create/modify 分类正确）
- **GUI 面板打开后始终显示「暂无文件活动记录」，且全程未发出任何 `/file-activity/api/stats` 请求**（network requests 证据：面板零请求，仅人工 fetch 的 200）。点击面板「刷新」按钮后数据**立即**正确显示：
  `读取 | readme.txt`、`新增 | created-by-agent.txt`、目录树 `.verify-tmp-3106 | 读 2 | 增 1 | 改 1`
- 根因（DOM/源码证据）：宿主 `@deepseek-ai/dsh-client-ui-sidebar-right` 渲染 `sidebar.right.pane.tab` 席位时是 `renderSlot(seat, {}, { entryKey, fallback, hookContext })`——**props 为空对象，能力全部经 hookContext（`useTabInfo` 等）传递**。浏览器内实测 `FileActivityView` 的 props 键为
  `usePanelInfo,useSessions,useSessionPendingInteraction,useWorkspaces,useResource,sessionId,inputActions,useSession,useConversation,useInput,useTrajectory,useChat,useProjection,useTabInfo,dataStore`，
  **没有 `visible`**；而 `src/client/parts/view.ts` 的 `useSessionLoader` 守卫是 `if (!visible || sessionId === '') return` → `visible===undefined` 恒真 → 不首载、不轮询（`POLL_MS` 失效）。属 #187「迁移到宿主原生侧边栏 API」的遗留：可见性判断仍按旧式 better-sidebar 的 `visible` prop 写。

### 2. 预览浮窗 / 文件类型图标（通过，但不含 HTML 沙箱预览，见证据 C）

- **代码预览**：点 `readme.txt` → 浮窗 `.dfa-fp` 722×441、`.dfa-fp-body` 720×402（`display:flex;flex-direction:column;min-height:0;overflow-y:auto` —— #111 契约保持）、内容 `.dfa-fp-code` 696×382 撑满，标题 `readme.txt`，正文为编辑后文本 ✓
- **图片预览**：点 `pixel.png` → `<img class="dfa-fp-img" src="/file-activity/file?sessionId=…&path=…pixel.png">`，`naturalWidth×Height=8×8`、`complete=true`（媒体路由按会话记录授权）✓
- **文件类型图标**：文件统计行均为「圆角 SVG + 类型标签」：`TXT`、`{}`(json)、`</>`(html)、`IMG`、`JS`、`M↓`(md)；目录行为文件夹图标 ✓
- 浮窗关闭：`Esc` 可关闭 ✓（0.5.6 已验证的外部点击关闭本次未复测）

### 3. 易碎场景（通过）

- **持久化/写放大（#197）**：状态文件为 JSON Lines，24 行仅 2763 B（平均 ~115 B/事件；生产旧全量快照 ~934 KB）✓
- **重启恢复**：重启前 22 行/2641 B → `kill` 后 flush 仍 22 行/2641 B → 手工重启实例（同 DSH_HOME，新 token）→ 落盘仍 22 行/2641 B；浏览器重新打开页签并刷新后 **14 行数据完整**（`demo.html 3 分钟前…`，读 10/增 1/改 1 与重启前一致）✓
- **会话隔离**：旧会话 `stats → recent=5, files=7`；浏览器重启后 DSH 产生的新会话 `session-82eaa65e-…` `stats → recent=0, files=0`，其面板刷新后仍为空；切回旧会话后 14 行数据不复现于新会话 ✓

### 4. client UI 与交互（**部分通过；页签重开入口缺失 → 不勾选**，证据 B）

- 页签渲染：`.dfa-chip`=「文件活动」、`role=tab "文件活动 关闭"`、工具栏「新标签页 / 分栏 / 全屏」、面板「最近访问 / 文件统计」两段 ✓
- 交互：区块折叠 `.dfa-section-head-toggle` → 行数 14→9，再展开 9→14 ✓；目录树折叠 `.dfa-row-dir` → 14→6，展开 6→14 ✓；「刷新」拉取数据 ✓；「清空」弹出原生 `confirm`：「确定清空当前会话的全部文件活动记录？」（dismiss 后数据保持 14 行）✓
- 排序：最近访问为 LRU（最新事件置顶：`demo.html` 最新记录排第一）✓
- **缺陷 B（页签无法手动重开）**：关闭页签后，侧边栏「新标签页」菜单只有「开始 / 工作区文件 / 安全护栏」，**没有「文件活动」**；`sessionStorage` 被标记 `dsh-file-activity:auto-opened:loaded=1` 后刷新页面也不再自动打开 → 用户只能靠新建浏览器会话/清 storage 才能再看到该页签，与 README「关闭后仍可从侧边栏右上角的『新标签页』手动打开」不符。宿主菜单由 `tabs.guide()`（guide entries）驱动，插件 `ctx.sidebarRightTabs.register({id,kind,title})` 未提供 guide 入口。
- 设置页：设置面板内可见「文件活动」文本，但未定位到 `.dfa-set` 卡片节点（`settings.plugins.tab` 注册的实际渲染**未验证**）
- 全程 `agent-browser errors --json` = `errors: []`（无未捕获异常）；`data-dfa-degraded` 始终为 null（页签/预览/auto-open 注册均未降级）

### 5. 插件间联动（通过）

- 隔离实例复用生产配置组合（bundles + profile patch 叠加）：172 个 loader id 无重复，file-activity 行存在且唯一
- 启动日志（`dsh-web.log`）无 duplicate/error/exception；与 better-sidebar、my-guard、notify 等相邻插件共存，浏览器 console 无报错

### 6. API 断言（issue #257：`--api-path` 需浏览器会话）

脚本内 `--api-path` 在非交互环境取不到 token 会显式失败（已知脚本限制），故按 skill 要求改为**浏览器内同源 fetch**断言（带 cookie 会话）：

- `GET /file-activity/api/stats?sessionId=__probe__` → **200**（`recent=[{path:"mounted",op:"read"}]"`，即客户端 `mountProbe` 上报成功 → client half 已加载）
- `POST /file-activity/api/record` → **200**（API 造数据：demo.html/pixel.png/config.json/script.js/sub/notes.md 均 200，面板刷新后全部呈现）
- `GET /file-activity/file?sessionId=…&path=<已记录>&as=text` → 200；**未记录路径（/etc/hosts）→ 403** `path is not in this session's file activity`（授权模型生效）
- `GET /file-activity/file?sessionId=…&path=<已记录图片>` → 200（8×8 PNG，`content-type` 对齐）

### 7. 环境清理（通过）

```bash
agent-browser close                       # 仅关本会话（禁止 close --all）
lsof -ti :3106 | xargs kill               # 停实例
rm -rf /tmp/dsh-verify-real-3106 /tmp/dsh-verify-real-3106.console.log   # 含凭据副本与实例 token
rm -rf /Users/bsfeng/IdeaProjects/my-dsh-plugins/.verify-tmp-3106        # 本次验证夹具
```

- 停进程后 `/tmp/dsh-verify-real-3106` **被重建**（仅 `memory.json.tmp-51643`，0 B，进程退出期写入）→ 再次删除；此后 3 次复查（3s/8s/20s）均不存在，`ls -d /tmp/dsh-verify-real-3106*` 无残留
- `lsof -ti :3106` 无输出、`curl http://127.0.0.1:3106/` 无响应（http=000）、`ps` 无 `dsh --profile web --port 3106` 进程、`pgrep -fl "choose folder"` 为空
- 未触碰主实例（3080）与其它 agent 的验证实例（如 3108）

### 8. 可疑行为 / 回归清单

- **A（P0，功能级失败）**：面板不自动加载、不轮询（`visible` prop 在原生席位不存在），用户需手点「刷新」才看到一次性数据 —— 证据同上第 1 节
- **B（功能级失败）**：「新标签页」菜单无「文件活动」入口，页签关闭后无法手动重开（README 承诺失效）
- **C（疑似回归 / 文档不符）**：HTML 文件浮窗预览显示为**代码块**（`.dfa-fp-code` + `md-code-block`，无 iframe），而 README 第 76 行仍称「HTML：沙箱化渲染预览，内容撑满整个浮窗主体（iframe…）」；`preview-data.ts` 的 `viewerOf()` 仅分 image/pdf/markdown/text，无 html 分支（0.5.6 时代浮窗复用宿主 viewer 的 HTML 沙箱渲染）
- **D（状态有界性）**：客户端 `mountProbe()` 每次页面加载都向 `/file-activity/api/record` 写一条持久化记录（`sessionId="__probe__", path="mounted"`）；本次验证期间累计 9 行、重启后仍在（幽灵会话），长时间使用会让状态文件与 #197「状态有界」目标相悖（量级小，非阻塞）
- **E（环境侧，非插件缺陷）**：`agent-browser` 会话在连续 eval 期间重启浏览器 2 次（页面回 about:blank，需重新 open）；每次 DSH 新页面会创建新会话，需注意 `localStorage['dsh.sessions.current']`
