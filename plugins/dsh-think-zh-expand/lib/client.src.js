/**
 * dsh-think-zh-expand — client half (browser).
 *
 * 功能 2：思考（reasoning）内容默认展开显示。
 * 功能 3：界面标签中文化。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 先 tsc 编译
 * src/client/index.ts → lib/.client-build/index.js（CommonJS 单文件），
 * 再把编译产物注入到下方 /*__CLIENT_BUNDLE__* / 占位符处并写出
 * lib/client.js（DSH 实际提供的产物，单一 __ModuleLoader__ bundle，无相对
 * 路径 require）。产物必须提交（CI 只跑 node --check + 测试，不跑构建）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-think-zh-expand',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // useState 由编译后的 client bundle 使用；模板静态分析看不到 bundle 内容。
    const { createElement, useState } = require('react')
    // ── MarkdownView：三级渲染回退（issue #293）────────────────────────
    // 1) dsh-md-render 的 MarkdownView —— 首选渲染内核（issue #31/#186 决策不变）；
    // 2) 宿主 staticModules 的官方 @deepseek-ai/dsh-client-ui-primitives 的
    //    MarkdownText —— 未装 md-render 时仍是完整 GFM + KaTeX 渲染（零安装）；
    // 3) <pre data-dsh-think-zh-expand-fallback="true"> —— 极旧/裁剪宿主纯文本。
    // 注意：只 catch require 不是降级——必须真的换掉渲染组件，否则
    // createElement(null) 会在渲染期抛 `Element type is invalid ... but got: null`
    // （0.4.9 的假降级，issue #290/#293）。任一级不可用（require 抛错 / 导出非
    // 对象 / 组件非 function）都必须安全落到下一级，渲染期永不抛错。
    // labels 无默认值：官方 MarkdownText 直接读 labels.code.copyLabel，本插件
    // 是中文化插件，文案正好由它提供；codeLabels 兼容早期官方包（0.0.1-rc.1）。
    const ZH_MD_LABELS = {
      code: { copyLabel: '复制', copiedLabel: '已复制' },
      footnotes: '脚注',
    }
    const ZH_MD_CODE_LABELS = { copyLabel: '复制', copiedLabel: '已复制' }
    const isComponent = (value) => typeof value === 'function'
    function resolveMarkdownView() {
      try {
        const md = require('dsh-md-render')
        if (md && isComponent(md.MarkdownView)) return md.MarkdownView
      } catch {
        // 未安装 dsh-md-render：落到官方组件
      }
      try {
        const ui = require('@deepseek-ai/dsh-client-ui-primitives')
        if (ui && isComponent(ui.MarkdownText)) {
          const MarkdownText = ui.MarkdownText
          return (props) =>
            createElement(MarkdownText, {
              text: props.text,
              labels: ZH_MD_LABELS,
              codeLabels: ZH_MD_CODE_LABELS,
            })
        }
      } catch {
        // 宿主模块表没有官方组件：落到纯文本
      }
      return (props) => createElement('pre', { 'data-dsh-think-zh-expand-fallback': 'true' }, props.text)
    }
    const MarkdownView = resolveMarkdownView()

    // ── 共享图标（issue #54 阶段 0：dsh-shared/client-parts）──────────
    /*__PART_ICONS__*/

    // ── 共享样式注入（dsh-shared/client-parts，issue #186 P2）────────
    /*__PART_STYLE_TAG__*/

    // ── Client bundle（编译自 src/client/index.ts）──────────────────
    /*__CLIENT_BUNDLE__*/

    return module.exports
  },
})
