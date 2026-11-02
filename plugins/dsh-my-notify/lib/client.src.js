/**
 * dsh-my-notify — client half (browser). SOURCE TEMPLATE.
 *
 * 订阅 server 端 SSE 通道（/notify/api/stream，由 lib/index.js 广播），在
 * 收到通知帧后：
 *  - 系统通知（Notification API）：标题=会话标题，正文=类型+摘要；
 *    点击 → 聚焦窗口 + 打开对应会话（ctx.sessions.open）；
 *  - 提示音：Web Audio 合成短促「滴」声（无需音频资源；受浏览器自动播放
 *    策略约束，首次用户交互后解锁）；
 *  - 页面内 toast 兜底：权限被拒/关闭通知时仍可见提醒，点击同样跳转。
 *
 * 本地开关（localStorage）：
 *  - dsh-notify:notify = '0' 关闭系统通知（默认开）
 *  - dsh-notify:sound   = '0' 关闭提示音（默认开）
 *  - dsh-notify:toast   = '0' 关闭页面内 toast（默认开）
 *  - dsh-notify:volume  = 0~1 提示音音量（默认 0.6，issue #71）
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs 先用
 * tsconfig.client.json 把 src/client/parts/*.ts 编译成 lib/parts/*.js（无
 * import/export 的纯函数声明文本，共享 factory 作用域），再经下方 __PART_*__
 * 占位符（函数式 replaceAll，避免 $&/$1 特殊解释）拼接进 factory 作用域，写出
 * lib/client.js —— 即 DSH 实际服务的产物。产物必须提交；CI 只对产物执行
 * node --check（见 scripts/test-all.sh / .github/workflows/ci.yml）。
 *
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-notify',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    // ── i18n 文案与本地偏好（src/client/parts/i18n.ts）──────────────────
    /*__PART_I18N__*/

    // ── 共享图标（dsh-shared/client-parts/icons.part.js，issue #54）────
    /*__PART_PREFS__*/

    /*__PART_ICONS__*/

    // ── 通知内容构造 / 系统通知（render.ts）────────────────────────────
    /*__PART_NOTIFY_RENDER__*/

    // ── 运行时配置（server config → localStorage 播种 / toast / 音量）──
    /*__PART_RUNTIME_CONFIG__*/

    // ── 提示音 / 页面 toast / SSE 客户端 ──────────────────────────────
    /*__PART_AUDIO__*/
    /*__PART_TOAST__*/
    /*__PART_STREAM__*/

    // ── 飞书卡片渲染 + 文案数据模型（纯逻辑）──────────────────────────
    /*__PART_CARD_PREVIEW__*/
    /*__PART_COPY_MODEL__*/

    // ── 文案工作台（事件列表 / 编辑器 / 变量树 / 预览带）───────────────
    /*__PART_TEMPLATE_EDITOR__*/
    /*__PART_VAR_TREE__*/
    /*__PART_COPY_EVENTS__*/
    /*__PART_PREVIEW_BAND__*/
    /*__PART_COPY_EDITOR__*/

    // ── 渠道（列表 + 详情抽屉 + 卡片设计器）───────────────────────────
    /*__PART_CARD_DESIGNER__*/
    /*__PART_WEBHOOK_EDITOR__*/
    /*__PART_WEBHOOK_SETTINGS__*/

    // ── 设置分区（呈现 / 高级）+ 行控件 + 样式 ────────────────────────
    /*__PART_SETTINGS_ROWS__*/
    /*__PART_PRESENT_PANE__*/
    /*__PART_SECURE_PANE__*/

    // ── 简版面板（事件 → 文案 → 飞书卡片 → 送达）──────────────────────
    /*__PART_PANEL_STYLES__*/
    /*__PART_PANEL_COMPOSE__*/
    /*__PART_PANEL_PREVIEW__*/
    /*__PART_PANEL_DRAWER__*/
    /*__PART_PANEL__*/
    /*__PART_SETTINGS_STYLES__*/

    // ── 设置页外壳（简版面板 + 更多设置抽屉）──────────────────────────
    /*__PART_SETTINGS__*/

    return module.exports
  },
})
