/**
 * Smoke test for the dsh-think-zh-expand host half: mounts the plugin against a
 * mocked context and asserts the system-prompt section registration (Chinese
 * thinking instruction). The client half is browser-only; CI checks its syntax
 * with `node --check`.
 *
 * NOTE: assertions live INSIDE test() (not at module top level) so Stryker's
 * vitest-runner correctly attributes mutant kills to this test file.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { apply, PROMPT_TEXT } from '../lib/index.js'

/** Build a mocked plugin context and run apply, returning registered sections. */
function boot() {
  const sections = []
  const logs = []
  const ctx = {
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
  }
  apply(ctx)
  return { sections, logs }
}

test('registers exactly one system-prompt section with the Chinese instruction', async () => {
  const { sections } = boot()

  // 1. exactly one section registered
  assert.equal(sections.length, 1, 'one section registered')

  // 2. section identity: stable name, early order, Chinese instruction text
  const section = sections[0]
  assert.equal(section.name, 'dsh-think-zh', 'section name stable (avoids collision with chinese-thinking)')
  assert.equal(section.order, -90, 'section order -90 (read before the persona)')
  assert.equal(typeof section.text, 'string', 'section text is a string')
  assert.ok(section.text.includes('思考'), 'text covers thinking')
  assert.ok(section.text.includes('中文'), 'text forces Chinese')
  assert.ok(section.text.includes('回复'), 'text covers replies')

  // 3. structured rules (issue #1): key scenarios + code/term boundary
  assert.ok(section.text.includes('错误消息'), 'text covers English error-message scenario')
  assert.ok(section.text.includes('日志'), 'text covers English log/stack scenario')
  assert.ok(section.text.includes('不翻译'), 'text keeps code/commands/paths untranslated')
  assert.ok(section.text.includes('最高优先级'), 'text declares top priority over context')

  // 4. exported prompt constant is the same string the plugin injects
  assert.equal(section.text, PROMPT_TEXT, 'PROMPT_TEXT constant matches injected text')
})

test('inject list declares the systemPrompt hard dependency', async () => {
  const mod = await import('../lib/index.js')
  assert.ok(Array.isArray(mod.inject), 'inject is an array')
  assert.ok(mod.inject.includes('systemPrompt'), 'systemPrompt declared as a hard dependency')
})

test('apply logs an info line with the [dsh-think-zh-expand] prefix (issue #155)', async () => {
  const { logs } = boot()
  assert.ok(logs.length >= 1, 'at least one log line emitted')
  assert.ok(logs[0].startsWith('[dsh-think-zh-expand]'), 'log line carries the unified plugin prefix')
  assert.ok(logs[0].includes('已启用'), 'log line describes the enabled behavior')
})

test('apply tolerates a missing logger (optional chaining)', async () => {
  const sections = []
  const ctx = { systemPrompt: { section: (section) => sections.push(section) } }
  apply(ctx)
  assert.equal(sections.length, 1, 'section still registered without a logger')
})
