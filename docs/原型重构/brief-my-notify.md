# 原型 brief · dsh-my-notify

> 前置：[设计基线](设计基线.md)。产物：`docs/原型重构/dsh-my-notify.html`（单文件自包含）。
> 先读 plugins/dsh-my-notify/README.md、docs/通知提醒/概述.md，以及 src/client/parts/settings.ts、webhook-settings.ts、render.ts、stream.ts；渠道与模板看 src/webhook/adapters.ts、pusher.ts、webhook-store.ts；可看 assets/notify-toast.png。

## 场景（右下角「场景」胶囊）

1. **通知场景**（默认）：对话进行中，右下角依次弹出 end / ask / approval / subagentEnd 四种 toast，可点击跳转；顶部可切「系统通知 / toast 兜底 / 权限被拒」形态。
2. **设置·通知提醒**：设置弹层 → 插件 → 通知提醒，四类触发开关 + askMode + 去重窗口 + apiToken + webBaseUrl。
3. **Webhook 管理**：webhook 列表（企微 / 飞书 / 钉钉 / 通用），新增/编辑表单（渠道、URL、事件订阅、模板、加签、启用），失败记录。
4. **远程触发**：触发测试面板（title / body / sessionId）+ 成功/失败结果。

## 必须覆盖（验收逐条核对）

### 设置·通知提醒
- [ ] F1 四类触发开关：`会话结束`、`询问`、`审批`、`子代理完成`（说明文字各一行；子代理完成默认关）。
- [ ] F2 询问模式：`完整问题` / `摘要` 分段选择；去重窗口输入（毫秒，默认 3000）。
- [ ] F3 远程触发安全：`apiToken` 输入（密文/显示切换）+ 说明「设置后远程触发需带 x-notify-token 头」。
- [ ] F4 会话链接：`webBaseUrl` 输入 + 说明「配置后推送携带会话链接」。
- [ ] F5 保存按钮 + 「已保存」反馈；页面内三开关（系统通知 / 提示音 / 页面 toast）。

### Webhook
- [ ] F6 列表：渠道徽标（企业微信 / 飞书 / 钉钉 / 通用）、名称、URL 省略、事件订阅标签、启用开关、编辑/删除、最近推送状态（成功时间 / 失败次数）。
- [ ] F7 新增/编辑表单：渠道选择、Webhook URL、加签密钥、事件订阅复选（end/ask/approval/subagentEnd）、自定义模板 textarea、启用开关、测试发送。
- [ ] F8 失败记录：最近失败列表（时间、渠道、原因、重试 3 次）、可清空。
- [ ] F9 空态：无 webhook 时引导。

### 通知呈现
- [ ] F10 四类 toast：`会话结束`（成功绿点）、`询问`（accent）、`审批`（warn）、`子代理完成`（中性 +「子代理」前缀）；每条含标题、摘要、时间、跳转箭头。
- [ ] F11 系统通知样式示意（浏览器通知卡片）+ 点击聚焦说明。
- [ ] F12 通知权限被拒：toast 兜底提示 + 「重新请求权限」按钮。
- [ ] F13 提示音开关状态示意（试听按钮）。
- [ ] F14 远程触发面板：输入 + 「发送测试通知」+ 结果（成功 / 401 未授权 / 失败）。

## 文案与数据
- 渠道名：企业微信、飞书、钉钉、通用中转；事件：会话结束、询问、审批、子代理完成。
- 示例 toast：`CI 构建完成` / `agent 询问：是否继续执行迁移？` / `等待批准：bash rm -rf dist` / `子代理完成：文档审查`。
