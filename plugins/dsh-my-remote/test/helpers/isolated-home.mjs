/**
 * dsh-my-remote — 测试用 DSH_HOME 隔离与 fail-closed 写入防护。
 *
 * ## 为什么必须有这个文件（真实事故）
 *
 * `~/.dsh/profiles/web/cordis.patch.yml` 是用户的**真实生产配置**。一旦测试在
 * 「`DSH_HOME` 未设置」的窗口里写 patch，`dsh-shared` 的 `patchFileOf` 会回退到
 * `~/.dsh`，`writeFileSync` **整文件覆盖**它 —— 实测已造成一次真实配置被测试夹具
 * 覆盖（1090 → 299 字节）。
 *
 * 三层防线（缺一层都可能复发，故全部保留）：
 *  1. **提前隔离**：cucumber `Before` / vitest `setupFiles` 在**每个场景/测试文件**
 *     开始前就把 `DSH_HOME` 指向独立临时目录 —— 不依赖被测代码内部的 `boot()`；
 *  2. **写入前断言**：`writeIsolatedPatchFile` 落盘前校验目标路径（见
 *     `assertIsolatedPatchPath`），路径解析意外时**抛错中止**，绝不静默写真实配置；
 *  3. **防回归测试**：`test/host-home-isolation.mjs` 显式模拟「DSH_HOME 未设置 /
 *     指向真实目录」，断言抛错且真实文件内容与 mtime 均未变化。
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

/** 真实 DSH 配置根（`~/.dsh`，realpath 归一化；macOS 上 /tmp 与 /private/tmp 需统一）。 */
export function realDshRoot() {
  return join(safeRealpath(homedir()), '.dsh')
}

/**
 * 规范化路径：从**最深的已存在祖先**取 realpath，再把剩余段拼回去。
 *
 * 为什么不能直接 realpathSync：patch 目标目录（`profiles/web`）在首次写入前并不
 * 存在，realpathSync 会抛错 → 回退成未规范化的 `/var/...`，而 macOS 上 tmpdir 的
 * realpath 是 `/private/var/...`，两者比较必然失败（实测）。
 */
function canonicalize(target) {
  const abs = resolve(String(target))
  let existing = abs
  const rest = []
  for (;;) {
    try {
      const real = realpathSync(existing)
      return rest.length === 0 ? real : join(real, ...rest.reverse())
    } catch {
      const parent = dirname(existing)
      if (parent === existing) return abs
      rest.push(basename(existing))
      existing = parent
    }
  }
}

/** realpath（路径不存在时逐级回退到已存在祖先再拼回）。 */
function safeRealpath(target) {
  return canonicalize(target)
}

/** realpath 归一化后的临时目录根。 */
function realTmpRoot() {
  return safeRealpath(tmpdir())
}

/** 该路径是否位于 root 之下（含 root 本身）。 */
function underRoot(target, root) {
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
}

/**
 * 断言即将写入的 patch 路径是「测试隔离路径」，否则抛错。
 *
 * 判据（fail-closed，任一条不满足即抛错）：
 *  - 目标**不得**位于真实 `~/.dsh` 之下（这是事故的那一条路径）；
 *  - 目标**必须**位于系统临时目录之下（测试只允许写临时目录）。
 *
 * @returns {string} realpath 归一化后的目标路径
 */
export function assertIsolatedPatchPath(file) {
  const target = canonicalize(file)
  const realDir = dirname(target)
  const realTarget = target
  const dshRoot = realDshRoot()
  if (underRoot(realTarget, dshRoot)) {
    throw new Error(
      `[测试保护] 拒绝写入真实 DSH 配置：${realTarget}\n` +
        `真实配置目录 = ${dshRoot}。这通常是 DSH_HOME 未设置 / 被清空导致 patchFileOf 回退到 ~/.dsh —— ` +
        `请用 isolatedHome() 隔离，或检查 cucumber Before / vitest setupFiles 是否生效。`,
    )
  }
  const tmpRoot = realTmpRoot()
  if (!underRoot(realDir, tmpRoot)) {
    throw new Error(
      `[测试保护] 拒绝写入临时目录之外的路径：${realTarget}\n临时目录 = ${tmpRoot}。测试只允许写隔离目录。`,
    )
  }
  return realTarget
}

/** 断言 DSH_HOME 已设置为隔离目录（在写入前调用，失败信息更有指向性）。 */
export function assertDshHomeIsolated() {
  const home = process.env.DSH_HOME
  if (typeof home !== 'string' || home === '') {
    throw new Error(
      '[测试保护] process.env.DSH_HOME 未设置：此时 patchFileOf 会回退到真实 ~/.dsh，' +
        '任何写入都会覆盖真实配置。请先调用 isolatedHome()。',
    )
  }
  const realHome = safeRealpath(home)
  if (underRoot(realHome, realDshRoot())) {
    throw new Error(`[测试保护] process.env.DSH_HOME 指向真实配置目录：${realHome}`)
  }
  return realHome
}

/**
 * 写入隔离 patch 文件（三层防线之第 2 层）：先断言 DSH_HOME 已隔离、再断言目标
 * 路径在临时目录内且不在 ~/.dsh 下，最后才 `writeFileSync`。
 */
export function writeIsolatedPatchFile(file, text) {
  assertDshHomeIsolated()
  const target = assertIsolatedPatchPath(file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text)
  return target
}

/**
 * 创建一个隔离的 DSH_HOME 并切换过去；返回 `{ home, restore }`。
 * `restore()` 精确还原（原本未设置时**删除**该变量，不留半程状态）。
 */
export function isolatedHome(prefix = 'dsh-my-remote-test-') {
  const previous = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), prefix))
  process.env.DSH_HOME = home
  return {
    home,
    restore() {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      rmSync(home, { recursive: true, force: true })
    },
  }
}

/**
 * 真实配置文件的**只读**快照（内容 sha256 + size + mtimeMs）。
 * 防回归测试用它证明「测试前后真实配置零变化」（只读，绝不写）。
 */
export function snapshotRealConfig(file = defaultRealConfigPath()) {
  // 用**同一个 fd** 取 stat 与内容：`statSync(path)` + `readFileSync(path)` 是
  // check-then-use，两步之间文件可能被替换/改写（TOCTOU，CodeQL js/file-system-race），
  // 快照就会自相矛盾（size/mtimeMs 来自旧文件、sha256 来自新文件）。
  let fd
  try {
    fd = openSync(file, 'r')
    const stat = fstatSync(fd)
    const sha256 = createHash('sha256').update(readFileSync(fd)).digest('hex')
    return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs, sha256 }
  } catch {
    return { exists: false, size: 0, mtimeMs: 0, sha256: '' }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** 真实 profile 层 patch 文件路径（web profile）。 */
export function defaultRealConfigPath() {
  return join(realDshRoot(), 'profiles', 'web', 'cordis.patch.yml')
}
