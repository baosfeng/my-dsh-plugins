/**
 * 测试临时目录卫生守卫（防复发）。
 *
 * 规则：任何创建临时目录的文件都必须有**配对清理**（rmSync / removeCallback /
 * afterAll / afterEach / cucumber After）。否则目录只能靠 tmp 包的 process-exit
 * 钩子兜底 —— 进程非正常终止（vitest 超时杀 worker、CI 取消、SIGKILL）时钩子不执行，
 * 目录永久残留且无人回收。
 *
 * 实测教训：系统临时目录中曾累积 10136 个本仓测试残留目录 / 125 MB
 * （dsh-task-reliability-rescue- 3990、dsh-guard-feature-home- 2976、
 *   dsh-guard-test- 1840 …），其中 dsh-shared- 505 个正对应 shared.mjs 缺失的消费者。
 *
 * ⚠️ 能力边界（必读，防止把本条判据当成立即生效的保证）：
 *   本判据是**文件级近似**，只回答「这个文件里**有没有**清理调用」，
 *   **不回答**「清理调用是否真的会在残留发生的那一刻执行」。
 *   最大的三个残留源（rescue.mjs 3990 / world.mjs 2976 / host-mutation2.mjs 880，
 *   合计 77%）**都带 afterAll/After 并通过本判据** —— 它们的残留来自
 *   「worker 被强杀（vitest 超时 / CI 取消 / SIGKILL）时钩子根本不执行」，
 *   而这是静态分析**原理上无法验证**的。
 *   因此：本条判据只拦「整文件无任何清理调用」这类低级遗漏；
 *   「清理存在但异常终止不执行」由 scripts/test/tmp-residue-sweep.mjs
 *   （vitest globalSetup，有界清扫：仅清 >24h 且白名单前缀）兜底承担。
 *   收紧判据（如 rmSync 计数 ≥ 创建计数）经实测**不能**解决该盲区：
 *   rescue.mjs 计数为 create=1 / rmSync=1，仍然判定通过。
 *
 *   具体反例（本判据自身的结构性盲区 —— 勿删）：
 *   plugins/dsh-my-remote/test/host-home-isolation.mjs 曾经 **零** rmSync/removeCallback，
 *   但 :1 导入了 afterAll、:45 存在一个 afterAll（只断言真实配置未变，**不清 tmp**），
 *   于是本判据因 `afterAll(` 命中而**放行**；其 :120 还用 mkdtempSync —— 该目录
 *   不受 tmp 包管理，连 process-exit 兜底都没有，**每次运行必残留**。
 *   该文件已补配对清理（收集 guardHomeDirs + 独立 afterAll 循环 rmSync），
 *   但**判据的结构性盲区仍在**：「存在 afterAll/afterEach/After」≠「其中清理了 tmp」。
 *   这类残留最终由 tmp-residue-sweep.mjs（有界清扫）回收。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')

/** 创建临时目录的调用（tmp 包 dirSync / node mkdtempSync）。 */
const CREATE = /\b(dirSync|mkdtempSync)\s*\(/
/** 配对的清理调用（显式删除或测试生命周期钩子）。 */
const CLEAN = /\b(rmSync|removeCallback)\s*\(|\bafterAll\s*\(|\bafterEach\s*\(|\bAfter\s*\(/

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

function collectSources() {
  const files = []
  for (const entry of readdirSync(join(ROOT, 'plugins'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      files.push(...walk(join(ROOT, 'plugins', entry.name, 'test')))
    } catch {
      /* 该插件无 test 目录 */
    }
  }
  for (const entry of readdirSync(join(ROOT, 'scripts'), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === 'test') files.push(...walk(join(ROOT, 'scripts', 'test')))
    else if (entry.name.endsWith('.mjs')) files.push(join(ROOT, 'scripts', entry.name))
  }
  return files
}

test('创建临时目录的文件必须有配对清理（防残留回归）', () => {
  // 能力边界显式打印，避免这条判据被误读为「残留已被保证拦住」。
  console.log(
    '[tmp-hygiene] 边界声明：文件级近似判据，只防「整文件无任何清理调用」；' +
      '「清理代码存在但异常终止（SIGKILL/超时/CI 取消）不执行」不在其能力范围内，' +
      '由 tmp-residue-sweep.mjs（globalSetup，有界清扫 >24h 白名单残留）兜底。',
  )
  const offenders = []
  for (const file of collectSources()) {
    let src
    try {
      src = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (CREATE.test(src) && !CLEAN.test(src)) offenders.push(file.slice(ROOT.length + 1))
  }
  assert.deepEqual(
    offenders,
    [],
    '以下文件创建了临时目录但没有任何配对清理调用（进程非正常终止即永久残留）：\n' + offenders.join('\n'),
  )
})
