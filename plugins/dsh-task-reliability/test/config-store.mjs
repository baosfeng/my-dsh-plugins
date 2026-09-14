import { test } from 'vitest'
/**
 * dsh-task-reliability — config-store 单测（issue #27 配置可视化）。
 *
 * 验证配置持久化机制（与 dsh-notify 同契约）：
 *  - extractConfig：从 profile cordis.patch.yml 文本提取指定行 id 的 config
 *    块（YAML 子集解析：布尔/数字/字符串/数组）；
 *  - writePatchConfig：删除旧条目 + 追加新条目（原子写 tmp+rename），
 *    不破坏文件中的其他条目；
 *  - 持久化闭环：写入 → 重新读取 → 值正确（模拟重启后 loader 重新解析）。
 */
import assert from 'node:assert/strict'
import { rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirSync } from 'tmp'
import { join } from 'node:path'
import { extractConfig, writePatchConfig, patchFileOf, profileDirOf, currentProfile } from 'dsh-shared'

const tmpDirs = []

function tempDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-task-reliability-config-' }).name
  tmpDirs.push(dir)
  return dir
}

test('config-store suite', async () => {
  try {
    // ── 1. currentProfile / profileDirOf / patchFileOf ──────────────────
    {
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
    }

    // ── 2. extractConfig：无条目 → undefined ────────────────────────────
    {
      const text = '# comment\n- id: notify\n  name: dsh-my-notify\n'
      assert.equal(extractConfig(text, 'task-reliability'), undefined, 'missing row yields undefined')
    }

    // ── 3. extractConfig：解析布尔/数字/字符串/数组 ────────────────────
    {
      const text = [
        '- id: task-reliability',
        '  config:',
        "    apiToken: 'tok-1'",
        '    retryMax: 5',
        '    maxLoop: 10',
        '    maxVerify: 2',
        '    retryableCodes: [TIMEOUT, ETIMEDOUT, ECONNRESET]',
        '    retryBaseMs: 2000',
        '    autopilot: true',
        '    steerCooldownMs: 5000',
        '    saveDebounceMs: 300',
        '    resumeGraceMs: 1000',
        '    rateMaxActions: 20',
      ].join('\n')
      assert.deepEqual(
        extractConfig(text, 'task-reliability'),
        {
          apiToken: 'tok-1',
          retryMax: 5,
          maxLoop: 10,
          maxVerify: 2,
          retryableCodes: ['TIMEOUT', 'ETIMEDOUT', 'ECONNRESET'],
          retryBaseMs: 2000,
          autopilot: true,
          steerCooldownMs: 5000,
          saveDebounceMs: 300,
          resumeGraceMs: 1000,
          rateMaxActions: 20,
        },
        'config block parsed with correct types',
      )
    }

    // ── 4. writePatchConfig：文件不存在 → 创建 ─────────────────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      const saved = {
        apiToken: '',
        retryMax: 3,
        maxLoop: 8,
        maxVerify: 3,
        retryableCodes: ['TIMEOUT'],
        retryBaseMs: 1000,
        autopilot: false,
        steerCooldownMs: 8000,
        saveDebounceMs: 500,
        resumeGraceMs: 2000,
        rateMaxActions: 12,
      }
      await writePatchConfig(file, 'task-reliability', saved)
      assert.ok(existsSync(file), 'patch file created')
      const text = readFileSync(file, 'utf8')
      assert.ok(text.includes('- id: task-reliability'), 'row id present')
      assert.ok(text.includes('    retryMax: 3'), 'config value present')
      assert.deepEqual(extractConfig(text, 'task-reliability'), saved, 'round-trip read')
    }

    // ── 5. writePatchConfig：已有其他条目 → 追加且不破坏 ───────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      writeFileSync(file, '# header comment\n- id: think-zh-expand\n  name: dsh-think-zh-expand\n', 'utf8')
      await writePatchConfig(file, 'task-reliability', { retryMax: 4 })
      const text = readFileSync(file, 'utf8')
      assert.ok(text.includes('- id: think-zh-expand'), 'existing row preserved')
      assert.ok(text.includes('# header comment'), 'header comment preserved')
      assert.ok(text.includes('- id: task-reliability'), 'new row appended')
      assert.deepEqual(extractConfig(text, 'task-reliability'), { retryMax: 4 }, 'new row config readable')
    }

    // ── 6. writePatchConfig：已有同 id 条目 → 替换不重复 ───────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      writeFileSync(file, '- id: task-reliability\n  config:\n    retryMax: 1\n    autopilot: true\n', 'utf8')
      await writePatchConfig(file, 'task-reliability', { retryMax: 6, autopilot: false })
      const text = readFileSync(file, 'utf8')
      const count = text.split('\n').filter((line) => line === '- id: task-reliability').length
      assert.equal(count, 1, 'old row replaced, no duplicate')
      assert.deepEqual(
        extractConfig(text, 'task-reliability'),
        { retryMax: 6, autopilot: false },
        'replaced config readable',
      )
    }

    // ── 7. 持久化闭环：写入 → 重新读取 → 值正确（模拟重启） ────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      const saved = {
        apiToken: 'tok-9',
        retryMax: 7,
        maxLoop: 12,
        maxVerify: 4,
        retryableCodes: ['TIMEOUT', 'SERVER'],
        retryBaseMs: 500,
        autopilot: true,
        steerCooldownMs: 3000,
        saveDebounceMs: 200,
        resumeGraceMs: 500,
        rateMaxActions: 30,
      }
      await writePatchConfig(file, 'task-reliability', saved)
      const text = readFileSync(file, 'utf8')
      const restored = extractConfig(text, 'task-reliability')
      assert.deepEqual(restored, saved, 'config survives a simulated restart')
    }

    // ── 8. 字符串含单引号 → 转义往返 ──────────────────────────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      await writePatchConfig(file, 'task-reliability', { apiToken: "it's a token" })
      const text = readFileSync(file, 'utf8')
      assert.deepEqual(
        extractConfig(text, 'task-reliability'),
        { apiToken: "it's a token" },
        'single-quoted string round-trips',
      )
    }

    // ── 9. currentProfile：--profile 空参数 → 默认 web ────────────────
    {
      const dir = tempDir()
      const oldHome = process.env.DSH_HOME
      process.env.DSH_HOME = dir
      const oldArgv = process.argv
      try {
        process.argv = ['node', 'dsh', '--profile', '']
        assert.equal(currentProfile(), 'web', 'empty --profile value falls back to web')
        process.argv = ['node', 'dsh', '--profile']
        assert.equal(currentProfile(), 'web', 'missing --profile value falls back to web')
      } finally {
        process.argv = oldArgv
        process.env.DSH_HOME = oldHome
      }
    }

    // ── 10. extractConfig：config 块含注释行/空行/无值键 ──────────────
    {
      const text = [
        '- id: task-reliability',
        '  config:',
        '    # 注释行',
        '',
        '    retryMax: 5',
        '    apiToken:', // 无值键 → 忽略
        '    autopilot: true',
      ].join('\n')
      assert.deepEqual(
        extractConfig(text, 'task-reliability'),
        { retryMax: 5, autopilot: true },
        'comments/blank/valueless keys skipped',
      )
    }

    // ── 11. parseYamlScalar：双引号/裸字符串/浮点数/空值 ───────────────
    {
      const text = [
        '- id: task-reliability',
        '  config:',
        '    apiToken: "double-quoted"',
        '    note: bare-string',
        '    retryBaseMs: 1.5',
        '    empty:',
      ].join('\n')
      assert.deepEqual(
        extractConfig(text, 'task-reliability'),
        {
          apiToken: 'double-quoted',
          note: 'bare-string',
          retryBaseMs: 1.5,
        },
        'double-quoted/bare/float parsed; empty value skipped',
      )
    }

    // ── 12. parseFlowArray：数组含空项被过滤 ───────────────────────────
    {
      const text = ['- id: task-reliability', '  config:', '    codes: [TIMEOUT, , SERVER]'].join('\n')
      assert.deepEqual(
        extractConfig(text, 'task-reliability'),
        { codes: ['TIMEOUT', 'SERVER'] },
        'empty array items filtered',
      )
    }

    // ── 13. writePatchConfig：null 值序列化为 null ─────────────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      await writePatchConfig(file, 'task-reliability', { retryMax: null })
      const text = readFileSync(file, 'utf8')
      assert.ok(text.includes('    retryMax: null'), 'null value serialized')
      assert.deepEqual(extractConfig(text, 'task-reliability'), { retryMax: null }, 'null value round-trips')
    }

    // ── 14. writePatchConfig：条目在文件中间（前后都有其他条目） ───────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      writeFileSync(
        file,
        [
          '- id: think-zh-expand',
          '  name: dsh-think-zh-expand',
          '- id: task-reliability',
          '  config:',
          '    retryMax: 1',
          '- id: guardian',
          '  name: dsh-my-guardian',
        ].join('\n'),
        'utf8',
      )
      await writePatchConfig(file, 'task-reliability', { retryMax: 6 })
      const text = readFileSync(file, 'utf8')
      const lines = text.split('\n')
      assert.equal(
        lines.filter((line) => line === '- id: task-reliability').length,
        1,
        'middle row replaced, no duplicate',
      )
      assert.ok(text.includes('- id: think-zh-expand'), 'row before preserved')
      assert.ok(text.includes('- id: guardian'), 'row after preserved')
      assert.deepEqual(extractConfig(text, 'task-reliability'), { retryMax: 6 }, 'middle row config readable')
    }

    console.log('ALL CONFIG-STORE TESTS PASSED')
  } catch (err) {
    console.error(err)
    throw err
  } finally {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  }
})
