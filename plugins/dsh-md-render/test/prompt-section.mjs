/**
 * system-prompt section（合并后的 mermaid 能力声明）。
 *
 * 合并决策（issue #463）：**只保留 mermaid 能力声明**；中文思考指令
 * （原 dsh-think-zh-expand 的 dsh-think-zh section）不迁入，由 dsh-my-memory
 * 的「全局提示词」提供。因此本插件注册的 section 数恒为 0 或 1。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { dirSync } from 'tmp'
import { apply } from '../lib/index.js'
import {
  createPromptSection,
  PROMPT_MAX_CHARS,
  PROMPT_SECTION_NAME,
  PROMPT_SECTION_ORDER,
  PROMPT_TEXT,
} from '../lib/prompt.js'
import { patchFileOf } from 'dsh-shared'

const tmpDirs = []
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function boot(config) {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-md-render-prompt-' }).name
  tmpDirs.push(dir)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  mkdirSync(dirname(patchFileOf('web')), { recursive: true })
  const sections = []
  const disposers = []
  const ctx = {
    logger: { info() {}, warn() {} },
    get() {
      return undefined
    },
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') disposers.push(d)
      return d
    },
    webServer: {
      register() {
        return () => {}
      },
    },
    systemPrompt: {
      section: (s) => {
        sections.push(s)
        return () => {
          const i = sections.indexOf(s)
          if (i !== -1) sections.splice(i, 1)
        }
      },
    },
  }
  apply(ctx, config ?? {})
  return {
    sections,
    restore() {
      for (const d of disposers.splice(0)) d()
      if (oldHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = oldHome
    },
  }
}

test('默认注入恰好一条 section：mermaid 能力声明（中文思考指令不迁入）', () => {
  const booted = boot({})
  const names = booted.sections.map((s) => s.name)
  const order = booted.sections[0] && booted.sections[0].order
  booted.restore()
  assert.deepEqual(names, [PROMPT_SECTION_NAME], 'only the mermaid capability note')
  assert.equal(names.includes('dsh-think-zh'), false, 'the Chinese thinking instruction is NOT registered here')
  assert.equal(order, PROMPT_SECTION_ORDER, 'order preserved from the pre-merge plugin')
})

test('mermaid.injectPrompt=false → 零 section（含旧扁平键）', () => {
  const nested = boot({ mermaid: { injectPrompt: false } })
  const legacy = boot({ injectPrompt: false })
  const nestedCount = nested.sections.length
  const legacyCount = legacy.sections.length
  nested.restore()
  legacy.restore()
  assert.equal(nestedCount, 0, 'namespaced switch turns injection off')
  assert.equal(legacyCount, 0, 'legacy flat switch turns injection off')
})

test('文案有硬性长度上限且不含未注册变量（宿主 renderPrompt 对变量严格）', () => {
  assert.ok(PROMPT_TEXT.length <= PROMPT_MAX_CHARS, 'prompt stays within the documented budget')
  assert.equal(/[{][{][^}]+[}][}]/.test(PROMPT_TEXT), false, 'no template variables')
  assert.ok(PROMPT_TEXT.includes('mermaid'), 'mentions mermaid')
})

test('createPromptSection：开关关 → null（调用方据此跳过注册）', () => {
  assert.equal(createPromptSection(false), null, 'off -> null')
  assert.deepEqual(
    createPromptSection(true),
    { name: PROMPT_SECTION_NAME, order: PROMPT_SECTION_ORDER, text: PROMPT_TEXT },
    'on -> section',
  )
})
