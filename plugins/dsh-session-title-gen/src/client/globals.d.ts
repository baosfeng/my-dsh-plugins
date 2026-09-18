/**
 * dsh-session-title-gen — client 端 part 片段的全局类型声明（issue #385 设置页签）。
 *
 * src/client/strings.ts 与 src/client/settings.ts 是 part 片段（无 import/export →
 * TypeScript script 模式 → 全局作用域），它们引用的 React API、共享样式注入器与
 * CommonJS 变量都由 __ModuleLoader__ factory 作用域在运行时提供（模板 lib/client.src.js
 * 里 `const { createElement, useState, useEffect } = require('react')` + dsh-shared
 * client-parts 注入），这里补上这些运行时变量的类型契约。
 *
 * 本文件只被 tsconfig.client.json 加载（插件根 tsconfig.json 已 exclude src/client），
 * 不污染仓库级类型环境。
 */

// ── React（factory 作用域的 require('react') 解构注入）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
declare function useState<T = unknown>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void

// ── 共享样式注入器（dsh-shared/client-parts/style-tag.part.js，构建期拼接）──
declare function installStyles(
  ctx: { effect: (fn: () => void | (() => void), label?: string) => void },
  attr: string,
  css: string,
  label: string,
): void

// ── CommonJS（client.src.js 模板在 factory 作用域提供的 module/exports）──
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }
