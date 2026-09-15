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
    const { createElement, useState, isValidElementType: reactIsValidElementType } = require('react')
    // ── MarkdownView：三级渲染回退（issue #293）────────────────────────
    // 1) dsh-md-render 的 MarkdownView —— 首选渲染内核（issue #31/#186 决策不变）；
    // 2) 宿主 staticModules 的官方 @deepseek-ai/dsh-client-ui-primitives 的
    //    MarkdownText —— 未装 md-render 时仍是完整 GFM + KaTeX 渲染（零安装）；
    // 3) <pre data-dsh-think-zh-expand-fallback="true"> —— 极旧/裁剪宿主纯文本。
    // 只 catch require 不是降级（0.4.9 的假降级，#290/#293）：必须真的换掉渲染组件，
    // 否则 createElement(null) 渲染期抛 `Element type is invalid ... but got: null`。
    // 可用性判定必须用 React 语义：官方 MarkdownText 是 React.memo 返回的**对象**
    // （宿主实测 object($$typeof,type,compare)），`typeof === 'function'` 会把
    // memo/forwardRef 组件误判为不可用、直接落到 <pre>。优先用 react 自带的
    // isValidElementType（react 19 已不再导出 → 退化式是实际生效路径），两者都
    // 排除宿主标签字符串（垃圾导出值应落级，而不是渲染成未知标签）。
    const isComponentLike = (value) =>
      typeof value === 'function' || (typeof value === 'object' && value !== null && typeof value.$$typeof === 'symbol')
    const isRenderableComponent =
      typeof reactIsValidElementType === 'function'
        ? (value) => typeof value !== 'string' && reactIsValidElementType(value)
        : isComponentLike
    // labels 无默认值（仅渲染含代码块的 markdown 时才读 labels.code.copyLabel），
    // 中文文案由本中文化插件提供；codeLabels 兼容早期官方包（npm 0.0.1-rc.1）。
    const ZH_MD_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }
    const ZH_MD_CODE_LABELS = { copyLabel: '复制', copiedLabel: '已复制' }
    function resolveMarkdownView() {
      try {
        const md = require('dsh-md-render')
        if (md && isRenderableComponent(md.MarkdownView)) return md.MarkdownView
      } catch {
        // 未安装 dsh-md-render：落到官方组件
      }
      try {
        const ui = require('@deepseek-ai/dsh-client-ui-primitives')
        if (ui && isRenderableComponent(ui.MarkdownText)) {
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
