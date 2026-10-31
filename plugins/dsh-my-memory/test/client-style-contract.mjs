/**
 * 客户端样式契约门禁：**用到的 `dsh-my-memory-*` 类名必须在 STYLES 里有定义**。
 *
 * 防的是什么：issue #502 的 agent 记忆面板曾用 `dsh-my-memory-btn` /
 * `dsh-my-memory-btn-danger` / `dsh-my-memory-btn-primary` 三个类名，而
 * styles.ts 里一个都没有——按钮静默退化成浏览器默认样式，代码和测试都没报错，
 * 直到用户在真实面板上看到才发现。类名是字符串，TS 查不出来，只能靠扫描。
 *
 * 口径：
 *  - 「定义」= STYLES 模板串里出现过的 `.dsh-my-memory-xxx` 选择器；
 *  - 「使用」= 客户端代码里 className 的字符串字面量（含空格分隔的多个类）；
 *  - 模板串（`className: \`...\${...}\``）跳过：动态拼接无法静态判定，
 *    只做包含性检查会有漏报，宁可少查也不误报。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** STYLES 模板串的切片。 */
function stylesBlockOf(text) {
  const start = text.indexOf('const STYLES')
  const end = text.indexOf('`.trim()', start)
  assert.ok(start >= 0 && end > start, 'client.js 里找不到 STYLES 模板串（构建产物结构变了？）')
  return text.slice(start, end)
}

/** 被定义的类名集合。 */
function definedClasses(css) {
  return new Set([...css.matchAll(/\.(dsh-my-memory-[a-z0-9-]+)/g)].map((hit) => hit[1]))
}

/** 被使用的类名集合（只取字符串字面量）。 */
function usedClasses(text) {
  const used = new Set()
  for (const hit of text.matchAll(/className:\s*'([^'\n]*)'/g)) {
    for (const token of hit[1].split(/\s+/)) if (token.startsWith('dsh-my-memory-')) used.add(token)
  }
  for (const hit of text.matchAll(/className:\s*"([^"\n]*)"/g)) {
    for (const token of hit[1].split(/\s+/)) if (token.startsWith('dsh-my-memory-')) used.add(token)
  }
  return used
}

test('每个 dsh-my-memory-* 类名都在 STYLES 里有定义（防「按钮退化成浏览器默认样式」）', () => {
  const css = stylesBlockOf(source)
  const defined = definedClasses(css)
  const used = usedClasses(source)
  assert.ok(defined.size > 40, `样式定义解析异常（只解析到 ${defined.size} 个类名）`)
  assert.ok(used.size > 20, `类名使用解析异常（只解析到 ${used.size} 个类名）`)
  const missing = [...used].filter((name) => !defined.has(name)).sort()
  assert.deepEqual(missing, [], `以下类名被使用但没有样式定义：\n${missing.join('\n')}`)
})

test('agent 记忆面板不再使用 dsh-my-memory-btn 系类名（改走 iconbtn / btn-save）', () => {
  const used = usedClasses(source)
  for (const legacy of ['dsh-my-memory-btn', 'dsh-my-memory-btn-danger', 'dsh-my-memory-btn-primary']) {
    assert.ok(!used.has(legacy), `${legacy} 已废弃，应改用 dsh-my-memory-iconbtn / btn-save`)
  }
})
