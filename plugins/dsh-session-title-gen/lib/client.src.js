/**
 * dsh-session-title-gen — client half (settings tab, issue #385). SOURCE TEMPLATE.
 *
 * 提供「设置 → 插件 → 会话标题生成」设置页签：可视化编辑 8 项配置
 * （enabled / template / provider / model / maxTitleBytes / maxInputBytes /
 * maxOutputTokens / timeoutMs），保存经 PUT 到插件配置端点，由 host 半写回
 * profile 的 cordis.patch.yml 并热生效（详见 src/config-routes.ts）。
 *
 * 本插件的标题生成逻辑全在 server 端，client 半没有其它职责。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 先 tsc 编译
 * src/client/index.ts → lib/.client-build/index.js（CommonJS 单文件），再把编译产物、
 * src/client 的 part 片段（strings.ts / settings.ts 的产物）与 dsh-shared/client-parts
 * 的样式注入件依次注入下方占位符，写出 lib/client.js —— DSH 实际提供的产物（单一
 * __ModuleLoader__ bundle，无相对路径 require）。产物必须提交（CI 只跑
 * node --check + 测试，不跑构建）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-title-gen',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // useState / useEffect 供设置页 part 使用（模板静态分析看不到 part 内容，故在此一并解构）
    const { createElement, useState, useEffect } = require('react')

    // ── 共享样式注入（dsh-shared/client-parts，issue #186 P2）──────────
    /*__PART_STYLE_TAG__*/

    // ── 设置页文案（src/client/strings.ts 产物，issue #385）────────────
    /*__PART_STRINGS__*/

    // ── 设置页视图与注册（src/client/settings.ts 产物，issue #385）──────
    /*__PART_SETTINGS__*/

    // ── Client bundle（编译自 src/client/index.ts）──────────────────
    /*__CLIENT_BUNDLE__*/

    return module.exports
  },
})
