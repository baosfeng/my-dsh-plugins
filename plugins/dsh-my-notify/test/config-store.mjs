import { test } from 'vitest'
/**
 * dsh-my-notify — config-store 单测（issue #27 配置可视化）。
 *
 * 验证配置持久化机制：
 *  - extractConfig：从 profile cordis.patch.yml 文本提取指定行 id 的 config
 *    块（YAML 子集解析：布尔/数字/字符串/数组）；
 *  - writePatchConfig：删除旧条目 + 追加新条目（原子写 tmp+rename），
 *    不破坏文件中的其他条目；
 *  - 持久化闭环：写入 → 重新读取 → 值正确（模拟重启后 loader 重新解析）。
 */
import assert from 'node:assert/strict'
import { rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { extractConfig, writePatchConfig, patchFileOf, profileDirOf, currentProfile } from 'dsh-shared'

const tmpDirs = []

function tempDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-my-notify-config-' }).name
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
      const text = '# comment\n- id: think-zh-expand\n  name: dsh-think-zh-expand\n'
      assert.equal(extractConfig(text, 'notify'), undefined, 'missing row yields undefined')
    }

    // ── 3. extractConfig：有条目无 config → undefined ───────────────────
    {
      const text = '- id: notify\n  name: dsh-my-notify\n'
      assert.equal(extractConfig(text, 'notify'), undefined, 'row without config yields undefined')
    }

    // ── 4. extractConfig：解析布尔/数字/字符串/数组 ────────────────────
    {
      const text = [
        '- id: notify',
        '  config:',
        '    end: false',
        '    ask: true',
        '    approval: true',
        '    subagentEnd: false',
        "    apiToken: 'secret-token'",
        '    dedupeMs: 3000',
      ].join('\n')
      assert.deepEqual(
        extractConfig(text, 'notify'),
        {
          end: false,
          ask: true,
          approval: true,
          subagentEnd: false,
          apiToken: 'secret-token',
          dedupeMs: 3000,
        },
        'config block parsed with correct types',
      )
    }

    // ── 5. extractConfig：数组值（retryableCodes 风格） ─────────────────
    {
      const text = [
        '- id: task-reliability',
        '  config:',
        '    retryableCodes: [TIMEOUT, ETIMEDOUT]',
        '    retryMax: 5',
      ].join('\n')
      assert.deepEqual(
        extractConfig(text, 'task-reliability'),
        {
          retryableCodes: ['TIMEOUT', 'ETIMEDOUT'],
          retryMax: 5,
        },
        'array values parsed',
      )
    }

    // ── 6. writePatchConfig：文件不存在 → 创建 ─────────────────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      await writePatchConfig(file, 'notify', {
        end: false,
        ask: true,
        approval: true,
        subagentEnd: false,
        apiToken: '',
        dedupeMs: 3000,
      })
      assert.ok(existsSync(file), 'patch file created')
      const text = readFileSync(file, 'utf8')
      assert.ok(text.includes('- id: notify'), 'row id present')
      assert.ok(text.includes('    end: false'), 'config value present')
      assert.deepEqual(
        extractConfig(text, 'notify'),
        { end: false, ask: true, approval: true, subagentEnd: false, apiToken: '', dedupeMs: 3000 },
        'round-trip read',
      )
    }

    // ── 7. writePatchConfig：已有其他条目 → 追加且不破坏 ───────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      writeFileSync(file, '# header comment\n- id: think-zh-expand\n  name: dsh-think-zh-expand\n', 'utf8')
      await writePatchConfig(file, 'notify', { end: false })
      const text = readFileSync(file, 'utf8')
      assert.ok(text.includes('- id: think-zh-expand'), 'existing row preserved')
      assert.ok(text.includes('# header comment'), 'header comment preserved')
      assert.ok(text.includes('- id: notify'), 'new row appended')
      assert.deepEqual(extractConfig(text, 'notify'), { end: false }, 'new row config readable')
    }

    // ── 8. writePatchConfig：已有同 id 条目 → 替换不重复 ───────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      writeFileSync(file, '- id: notify\n  config:\n    end: true\n    ask: true\n', 'utf8')
      await writePatchConfig(file, 'notify', {
        end: false,
        ask: false,
        approval: true,
        subagentEnd: false,
        apiToken: '',
        dedupeMs: 3000,
      })
      const text = readFileSync(file, 'utf8')
      const count = text.split('\n').filter((line) => line === '- id: notify').length
      assert.equal(count, 1, 'old row replaced, no duplicate')
      assert.deepEqual(
        extractConfig(text, 'notify'),
        {
          end: false,
          ask: false,
          approval: true,
          subagentEnd: false,
          apiToken: '',
          dedupeMs: 3000,
        },
        'replaced config readable',
      )
    }

    // ── 9. 持久化闭环：写入 → 重新读取 → 值正确（模拟重启） ────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      const saved = {
        end: false,
        ask: true,
        approval: false,
        subagentEnd: true,
        apiToken: 'tok-123',
        dedupeMs: 5000,
      }
      await writePatchConfig(file, 'notify', saved)
      // 模拟重启：重新从文件读取
      const text = readFileSync(file, 'utf8')
      const restored = extractConfig(text, 'notify')
      assert.deepEqual(restored, saved, 'config survives a simulated restart')
    }

    // ── 10. 字符串含单引号 → 转义往返 ──────────────────────────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      await writePatchConfig(file, 'notify', { apiToken: "it's a token" })
      const text = readFileSync(file, 'utf8')
      assert.deepEqual(extractConfig(text, 'notify'), { apiToken: "it's a token" }, 'single-quoted string round-trips')
    }

    // ── 11. currentProfile：--profile 空参数 → 默认 web ────────────────
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

    // ── 12. extractConfig：config 块含注释行/空行/无值键 ──────────────
    {
      const text = [
        '- id: notify',
        '  config:',
        '    # 注释行',
        '',
        '    end: false',
        '    apiToken:', // 无值键 → 忽略
        '    dedupeMs: 3000',
      ].join('\n')
      assert.deepEqual(
        extractConfig(text, 'notify'),
        { end: false, dedupeMs: 3000 },
        'comments/blank/valueless keys skipped',
      )
    }

    // ── 13. parseYamlScalar：双引号/裸字符串/浮点数/空值 ───────────────
    {
      const text = [
        '- id: notify',
        '  config:',
        '    apiToken: "double-quoted"',
        '    note: bare-string',
        '    dedupeMs: 1.5',
        '    empty:',
      ].join('\n')
      assert.deepEqual(
        extractConfig(text, 'notify'),
        {
          apiToken: 'double-quoted',
          note: 'bare-string',
          dedupeMs: 1.5,
        },
        'double-quoted/bare/float parsed; empty value skipped',
      )
    }

    // ── 14. parseFlowArray：数组含空项被过滤 ───────────────────────────
    {
      const text = ['- id: notify', '  config:', '    codes: [TIMEOUT, , SERVER]'].join('\n')
      assert.deepEqual(extractConfig(text, 'notify'), { codes: ['TIMEOUT', 'SERVER'] }, 'empty array items filtered')
    }

    // ── 15. writePatchConfig：null 值序列化为 null ─────────────────────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      await writePatchConfig(file, 'notify', { end: null })
      const text = readFileSync(file, 'utf8')
      assert.ok(text.includes('    end: null'), 'null value serialized')
      assert.deepEqual(extractConfig(text, 'notify'), { end: null }, 'null value round-trips')
    }

    // ── 16. writePatchConfig：条目在文件中间（前后都有其他条目） ───────
    {
      const dir = tempDir()
      const file = join(dir, 'cordis.patch.yml')
      writeFileSync(
        file,
        [
          '- id: think-zh-expand',
          '  name: dsh-think-zh-expand',
          '- id: notify',
          '  config:',
          '    end: true',
          '- id: guardian',
          '  name: dsh-my-guardian',
        ].join('\n'),
        'utf8',
      )
      await writePatchConfig(file, 'notify', { end: false })
      const text = readFileSync(file, 'utf8')
      const lines = text.split('\n')
      assert.equal(lines.filter((line) => line === '- id: notify').length, 1, 'middle row replaced, no duplicate')
      assert.ok(text.includes('- id: think-zh-expand'), 'row before preserved')
      assert.ok(text.includes('- id: guardian'), 'row after preserved')
      assert.deepEqual(extractConfig(text, 'notify'), { end: false }, 'middle row config readable')
    }

    console.log('ALL CONFIG-STORE TESTS PASSED')
  } catch (err) {
    console.error(err)
    throw err
  } finally {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  }
})
