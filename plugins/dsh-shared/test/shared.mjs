/**
 * dsh-shared — config-store / project / async / persist 单元测试。
 *
 * 这些模块由各插件抽取合并（issue #45），依赖方插件的测试已通过
 * dsh-shared import 覆盖其行为；本文件补充 dsh-shared 自包含的核心断言。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import {
  currentProfile,
  profileDirOf,
  patchFileOf,
  extractConfig,
  writePatchConfig,
  findProjectRoot,
  withTimeout,
  userMessage,
  atomicWriteJson,
} from '../lib/index.js'

const tmpDirs = []

function tempDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-shared-' }).name
  tmpDirs.push(dir)
  return dir
}

// 配对清理：tmp 的 process-exit 钩子在 worker 被强杀（超时 / CI 取消 / SIGKILL）时
// 不执行，目录会永久残留在 os.tmpdir()。实测该前缀曾累积 505 个残留目录。
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('config-store: currentProfile / profileDirOf / patchFileOf', () => {
  const dir = tempDir()
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    assert.equal(currentProfile(), 'web', 'default profile is web')
    assert.equal(profileDirOf('web'), join(dir, 'profiles', 'web'), 'profile dir under $DSH_HOME/profiles')
    assert.equal(patchFileOf('web'), join(dir, 'profiles', 'web', 'cordis.patch.yml'), 'patch file name')
  } finally {
    process.env.DSH_HOME = oldHome
  }
})

test('config-store: extractConfig parses YAML subset and writePatchConfig round-trips', async () => {
  const dir = tempDir()
  const file = join(dir, 'cordis.patch.yml')
  writeFileSync(file, '- id: other\n  name: x\n', 'utf8')
  await writePatchConfig(file, 'shared', { end: false, apiToken: "it's a token", codes: [1, 2] })
  const text = readFileSync(file, 'utf8')
  assert.ok(text.includes('- id: other'), 'existing row preserved')
  assert.deepEqual(
    extractConfig(text, 'shared'),
    {
      end: false,
      apiToken: "it's a token",
      codes: [1, 2],
    },
    'round-trip read',
  )
  // 同 id 替换不重复
  await writePatchConfig(file, 'shared', { end: true })
  const lines = readFileSync(file, 'utf8').split('\n')
  assert.equal(lines.filter((l) => l === '- id: shared').length, 1, 'old row replaced')
})

test('config-store: extractConfig tolerates spacing variants after colon', () => {
  // 回归测试（CodeQL js/polynomial-redos 修复）：解析正则去掉 `\s*` 后，
  // 冒号后无空格 / 多空格 的解析行为必须与原实现一致
  const text = ['- id: a', '  config:', '    k1: v1', '    k2:v2', '    k3:   v3'].join('\n')
  assert.deepEqual(extractConfig(text, 'a'), { k1: 'v1', k2: 'v2', k3: 'v3' }, 'spacing variants parse identically')
})

test('config-store: 无值键「无更深缩进」→ 跳过（防复发：不许建空对象）', () => {
  // 防复发回归测试。3b3502d 引入嵌套块支持时把无值键**无条件**建成 `{}`，
  // 破坏了扁平语义（该提交自称「扁平行为不变」）→ CI 上 dsh-my-notify /
  // dsh-task-reliability 的 config-store.mjs 断言 `apiToken: {}` 判红，而本地被
  // node_modules 里的陈旧 registry 副本 dsh-shared@0.1.4 遮蔽、看到的是旧实现 → 假绿。
  //
  // 语义判据（与 YAML 一致 + 与两消费方既有断言一致）：无值键**只有在后面跟着
  // 更深缩进的子块**时才是「嵌套段」；否则按 YAML 它是 null（空值），本解析器
  // 一贯的既有语义是**跳过空值**（见本文件「empty value skipped」用例与
  // dsh-my-notify / dsh-task-reliability 的 config-store 用例），故跳过而非置 null。
  const text = [
    '- id: a',
    '  config:',
    '    k1: v1',
    '    empty1:', // 下一行同缩进 → 跳过
    '    k2: v2',
    '    empty2:   ', // 行尾空格也算无值 → 跳过
    '    # 注释行不算「更深缩进」',
    '',
    '    empty3:', // 其后仅注释/空行/块结束 → 跳过
  ].join('\n')
  assert.deepEqual(extractConfig(text, 'a'), { k1: 'v1', k2: 'v2' }, '无值键（无更深缩进）必须跳过，不得建空对象')
})

test('config-store: extractConfig parses nested config blocks (namespace sections)', () => {
  // 嵌套支持（纯增量，issue #463 需要）：值为空 **且后续行缩进更深** → 子对象；
  // 扁平键与嵌套段**混写**都要能读回来（合并后的 md-render 依赖这一点）。
  // 边界（本测试与上面「无值键跳过」用例互补，共同钉死判据）：只有「后面真有更深
  // 缩进的子键」才算嵌套段——注释/空行不算证据。
  const text = [
    '- id: a',
    '  config:',
    '    copyButton: true',
    '    markdown:',
    '      textFenceMarkdown: false',
    '      contextMarkdown: true',
    '    thinking:',
    '      defaultExpanded: false',
    '    mermaid:',
    '      injectPrompt: true',
  ].join('\n')
  assert.deepEqual(
    extractConfig(text, 'a'),
    {
      copyButton: true,
      markdown: { textFenceMarkdown: false, contextMarkdown: true },
      thinking: { defaultExpanded: false },
      mermaid: { injectPrompt: true },
    },
    'flat keys and nested sections parse side by side',
  )
})

test('config-store: nested config round-trips through writePatchConfig', async () => {
  const dir = tempDir()
  const file = join(dir, 'cordis.patch.yml')
  writeFileSync(file, '', 'utf8')
  const config = { markdown: { copyButton: false }, thinking: { defaultExpanded: true } }
  await writePatchConfig(file, 'nested', config)
  assert.deepEqual(extractConfig(readFileSync(file, 'utf8'), 'nested'), config, 'nested write → read round-trip')
})

test('config-store: extractConfig returns undefined when config block is absent', () => {
  // 无该 id 的直接条目（非嵌套 config 块）
  const flat = ['- id: a', '  name: x', '- id: b'].join('\n')
  assert.equal(extractConfig(flat, 'a'), undefined, 'entry without config: block → undefined')
  // 顶层条目提前跳出（config: 行之后缩进不足）→ 空对象
  const topLevel = ['- id: a', '  config:', '- id: b'].join('\n')
  assert.deepEqual(extractConfig(topLevel, 'a'), {}, 'no indented keys → empty config')
  // 无对应 id
  const other = ['- id: a', '  config:', '    k: v'].join('\n')
  assert.equal(extractConfig(other, 'missing'), undefined, 'unknown id → undefined')
})

test('config-store: yaml scalar round-trips null/object/numbers/quoted strings', async () => {
  const dir = tempDir()
  const file = join(dir, 'cordis.patch.yml')
  writeFileSync(file, '', 'utf8')
  // YAML 子集实际行为：null → 'null' 文本 → 读回真实 null；嵌套对象 → 缩进子块 → 读回对象；
  // 单引号转义 round-trip；双引号内容视作裸字符（无语义）。
  await writePatchConfig(file, 't', {
    nul: null,
    obj: { nested: true },
    int: 42,
    neg: -3.5,
    yes: true,
    quoted: "it's",
    double: '"dq"',
    arr: [1, 'a', false],
  })
  assert.deepEqual(
    extractConfig(readFileSync(file, 'utf8'), 't'),
    {
      nul: null,
      obj: { nested: true },
      int: 42,
      neg: -3.5,
      yes: true,
      quoted: "it's",
      double: '"dq"',
      arr: [1, 'a', false],
    },
    'scalar kinds parse as expected; null stays null, nested objects round-trip',
  )
})

test('findProjectRoot walks up to the nearest .git ancestor', async () => {
  const dir = tempDir()
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(dir, 'repo', 'sub'), { recursive: true })
  mkdirSync(join(dir, 'repo', '.git'), { recursive: true })
  assert.equal(await findProjectRoot(join(dir, 'repo', 'sub')), join(dir, 'repo'), 'nearest .git ancestor')
  assert.equal(await findProjectRoot(join(dir, 'no-git-here')), join(dir, 'no-git-here'), 'no .git → cwd itself')
})

test('withTimeout resolves undefined on timeout and keeps the value on settle', async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 200))
  assert.equal(await withTimeout(slow, 20), undefined, 'timeout → undefined')
  const fast = Promise.resolve('ok')
  assert.equal(await withTimeout(fast, 100), 'ok', 'settled value kept')
  const rejected = Promise.reject(new Error('boom'))
  assert.equal(await withTimeout(rejected, 100), undefined, 'rejection → undefined (no throw)')
})

test('userMessage builds a user-role message with text block', () => {
  const msg = userMessage('hello')
  assert.equal(msg.role, 'user')
  assert.deepEqual(msg.content, [{ type: 'text', text: 'hello' }])
  assert.equal(msg.source.kind, 'user')
  assert.ok(msg.id.startsWith('msg-'), 'id generated')
})

test('atomicWriteJson writes tmp+rename and warns on failure', async () => {
  const dir = tempDir()
  const file = join(dir, 'nested', 'state.json')
  const warnings = []
  const logger = { warn: (m) => warnings.push(m) }
  await atomicWriteJson(file, { ok: true }, logger, '[test]')
  assert.equal(existsSync(file), true, 'file created (dirs auto-made)')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { ok: true }, 'content written')
  // 失败路径：路径中间段是普通文件 → mkdir 必报 ENOTDIR → 告警不抛出。
  // ⚠️ 不要用「父目录不存在」（如 /nonexistent-dir-xyz）或「chmod 只读目录」注入：
  // 前者在 root（容器内 UID 0）下 mkdir recursive 会真的建出该目录而写成功（断言
  // 恒失败，还会在根目录留下副作用），后者被 CAP_DAC_OVERRIDE 绕过。ENOTDIR 是
  // 类型不符的确定性失败，root/非 root、Windows、只读挂载下结论一致。
  const blocker = join(dir, 'not-a-dir')
  writeFileSync(blocker, 'x')
  await atomicWriteJson(join(blocker, 'sub', 'state.json'), { a: 1 }, logger, '[test]')
  assert.equal(warnings.length, 1, 'failure warned')
  assert.ok(warnings[0].includes('[test] persist failed'), 'warning carries prefix')
})
