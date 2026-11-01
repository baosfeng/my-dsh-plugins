/**
 * #121 回归：详情读取的类型判定 / 大小 / 内容必须同源于**一个 fd**。
 *
 * 背景：旧实现 `stat(file)` 取 size 之后再 `open(file,'r')` 读内容，两次按名解析之间
 * 存在 TOCTOU 窗口（CodeQL `js/file-system-race`）：窗口里文件被替换，truncated 会按旧
 * size 判定、内容却来自新 inode。正确形态是 open → handle.stat()（fstat）→ 同一个 handle 读。
 *
 * 断言刻意钉在「读详情这条路径上有没有按名 stat」与「open 之后文件被删/替换还能不能读到
 * open 时的那个 inode」上：只断言「内容对」对旧实现同样成立，等于没测。
 * 注入方式：vi.mock 包一层真实 `node:fs/promises`，只做调用记录 + 在 open 之后插入文件系统
 * 变化，其余行为原样透传。
 */
import { test, afterEach, afterAll, vi } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { MAX_DETAIL_BYTES, readSkillDetail } from '../lib/server/detail.js'

/** 调用探针：按名 stat / open 的目标、fstat 次数、open 之后要执行的注入。 */
const probe = vi.hoisted(() => ({ statPaths: [], opened: [], fstatCalls: 0, afterOpen: null, afterRealpath: null }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    realpath: async (target) => {
      const real = await actual.realpath(target)
      // 命中才消费，避免被根目录那一次 realpath 提前吃掉。
      if (probe.afterRealpath?.(real)) probe.afterRealpath = null
      return real
    },
    stat: (target, ...rest) => {
      if (typeof target === 'string') probe.statPaths.push(target)
      return actual.stat(target, ...rest)
    },
    open: async (target, flags, mode) => {
      probe.opened.push(target)
      const handle = await actual.open(target, flags, mode)
      // open 已返回、fd 已就位：此刻的删除/替换正是要挡的竞态窗口。
      if (probe.afterOpen?.(target)) probe.afterOpen = null
      return new Proxy(handle, {
        get(obj, key) {
          if (key === 'stat') {
            return () => {
              probe.fstatCalls += 1
              return obj.stat()
            }
          }
          const value = Reflect.get(obj, key)
          return typeof value === 'function' ? value.bind(obj) : value
        },
      })
    },
  }
})

const home = dirSync({ unsafeCleanup: true, prefix: 'dsm-detail-race-' }).name
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

const userRoot = join(home, 'skills')
mkdirSync(userRoot, { recursive: true })

afterEach(() => {
  probe.statPaths.length = 0
  probe.opened.length = 0
  probe.fstatCalls = 0
  probe.afterOpen = null
  probe.afterRealpath = null
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

/** 断言抛出指定错误码的 DetailError。 */
async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, 'DetailError', `expected DetailError, got ${error}`)
    assert.equal(error.code, code)
    return true
  })
}

test('正常读取：大小取自 fstat、全程零次按名 stat、打开目标是 realpath 结果', async () => {
  mkdirSync(join(userRoot, 'plain'), { recursive: true })
  writeFileSync(join(userRoot, 'plain', 'SKILL.md'), '# plain\n', 'utf8')

  const detail = await readSkillDetail({ name: 'plain' })

  assert.equal(detail.content, '# plain\n')
  assert.equal(detail.truncated, false)
  assert.deepEqual(probe.statPaths, [], '读详情不得再按名 stat（TOCTOU 窗口）')
  assert.equal(probe.fstatCalls, 1, '大小必须来自 fd 的 fstat')
  assert.equal(probe.opened.at(-1), detail.path, '打开目标必须是 realpath 之后的那条路径')
})

test('>256KB 仍截断为 truncated:true，且只依赖 fd 的大小', async () => {
  mkdirSync(join(userRoot, 'big'), { recursive: true })
  writeFileSync(join(userRoot, 'big', 'SKILL.md'), 'a'.repeat(MAX_DETAIL_BYTES + 4096), 'utf8')

  const detail = await readSkillDetail({ name: 'big' })

  assert.equal(detail.truncated, true)
  assert.equal(Buffer.byteLength(detail.content, 'utf8'), MAX_DETAIL_BYTES)
  assert.deepEqual(probe.statPaths, [])
})

test('open 之后文件被删除：不崩，仍返回 open 时的内容', async () => {
  const file = join(userRoot, 'gone', 'SKILL.md')
  mkdirSync(join(userRoot, 'gone'), { recursive: true })
  writeFileSync(file, '# gone\n', 'utf8')
  probe.afterOpen = (target) => {
    if (target !== file) return false
    unlinkSync(target)
    return true
  }

  const detail = await readSkillDetail({ name: 'gone' })

  assert.equal(detail.content, '# gone\n')
  assert.equal(detail.truncated, false)
  assert.equal(existsSync(file), false, '注入确实删掉了文件（窗口非空）')
})

test('open 之后文件被替换成 >256KB：大小与内容同源，不会自相矛盾', async () => {
  const file = join(userRoot, 'swap', 'SKILL.md')
  mkdirSync(join(userRoot, 'swap'), { recursive: true })
  writeFileSync(file, '# small\n', 'utf8')
  probe.afterOpen = (target) => {
    if (target !== file) return false
    unlinkSync(target)
    writeFileSync(target, 'b'.repeat(MAX_DETAIL_BYTES + 1024), 'utf8')
    return true
  }

  const detail = await readSkillDetail({ name: 'swap' })

  // 若 size 来自「按名 stat」而内容来自 fd（或反之），这里就会变成
  // truncated:true + 旧内容 / false + 新内容 —— 两者都不允许。
  assert.equal(detail.content, '# small\n')
  assert.equal(detail.truncated, false)
  assert.deepEqual(probe.statPaths, [])
})

test('realpath 之后、open 之前文件被删除：按未命中处理，不崩成 500', async () => {
  const file = join(userRoot, 'vanish', 'SKILL.md')
  mkdirSync(join(userRoot, 'vanish'), { recursive: true })
  writeFileSync(file, '# vanish\n', 'utf8')
  probe.afterRealpath = (real) => {
    if (real !== file) return false
    unlinkSync(real)
    return true
  }

  await expectCode(readSkillDetail({ name: 'vanish' }), 'not-found')
  assert.equal(existsSync(file), false, '注入确实删掉了文件（窗口非空）')
})

test('候选不是普通文件（SKILL.md 是目录）时按未命中处理，不当文件读', async () => {
  mkdirSync(join(userRoot, 'dir-skill', 'SKILL.md'), { recursive: true })
  await expectCode(readSkillDetail({ name: 'dir-skill' }), 'not-found')
})
