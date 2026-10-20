/**
 * `/md-render/api/project-lang` —— 项目主语言探测（host half）。
 *
 * 用途：无语言围栏的内容识别认不出语言时，client 半拿「项目主体是什么语言」兜底
 * （真实会话取证：208 个围栏里 200 个无语言标记）。
 *
 * **安全边界是本节的头号断言**（它们是这个能力的全部代价，不能被顺手放宽）：
 *  · 只接受**绝对路径** cwd（非空、≤512 字符），相对路径 / 空值 / 超长一律空结果；
 *  · 只对**固定标记文件清单**做 lstat：不遍历目录、不读文件内容、**不跟随符号链接**；
 *  · 响应只含 { lang, evidence }，不含文件内容或目录清单；
 *  · 结果按 cwd 有界缓存（TTL 10 分钟）。
 *
 * 判据来源：`src/routes/project-lang.ts`（本文件逐条钉住它的对外语义）。
 */
import { test, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CACHE_MAX,
  CACHE_TTL_MS,
  MAX_CWD_CHARS,
  PROJECT_MARKERS,
  clearProjectLangCache,
  createProjectLangHandler,
  cwdOfRequest,
  detectProjectLang,
} from '../lib/routes/project-lang.js'

/** 造临时项目目录（测试结束由 OS 回收；每个用例独立）。 */
async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'mdr-proj-'))
  for (const file of files) {
    const path = join(dir, file)
    await mkdir(join(path, '..'), { recursive: true }).catch(() => {})
    await writeFile(path, 'x')
  }
  return dir
}

/** 假 response：记录状态码与 JSON body（dsh-shared 的 writeJson 走 writeHead + end）。 */
function fakeResponse() {
  const res = {
    statusCode: 0,
    headers: null,
    body: null,
    writeHead(status, headers) {
      res.statusCode = status
      res.headers = headers
    },
    setHeader() {},
    end(text) {
      res.body = JSON.parse(text)
    },
  }
  return res
}

beforeEach(() => clearProjectLangCache())

test('构建标记文件 → 语言（Kotlin / TypeScript / Go / Rust / Python / Java）', async () => {
  const cases = [
    [['build.gradle.kts'], 'kotlin', 'build.gradle.kts'],
    [['settings.gradle.kts'], 'kotlin', 'settings.gradle.kts'],
    [['tsconfig.json', 'package.json'], 'typescript', 'tsconfig.json'],
    [['package.json'], 'javascript', 'package.json'],
    [['go.mod'], 'go', 'go.mod'],
    [['Cargo.toml'], 'rust', 'Cargo.toml'],
    [['pyproject.toml'], 'python', 'pyproject.toml'],
    [['pom.xml'], 'java', 'pom.xml'],
    [['build.gradle'], 'java', 'build.gradle'],
    [['Package.swift'], 'swift', 'Package.swift'],
  ]
  for (const [files, lang, evidence] of cases) {
    const dir = await project(files)
    const value = await detectProjectLang(dir)
    assert.equal(value.lang, lang, files.join('+') + ' → ' + lang)
    assert.equal(value.evidence, evidence, '证据文件：' + evidence)
    await rm(dir, { recursive: true, force: true })
  }
})

test('优先级：越具体的构建系统越靠前（tsconfig > package.json / build.gradle.kts > build.gradle）', async () => {
  const dir = await project(['package.json', 'tsconfig.json'])
  assert.equal((await detectProjectLang(dir)).lang, 'typescript', 'TS 项目不能报成 JS')
  const java = await project(['build.gradle', 'build.gradle.kts'])
  assert.equal((await detectProjectLang(java)).lang, 'kotlin', 'Kotlin DSL 优先于 Groovy')
  await rm(dir, { recursive: true, force: true })
  await rm(java, { recursive: true, force: true })
})

test('安全边界：只接受绝对路径（相对路径 / 空 / 超长 / 不存在 → 空结果）', async () => {
  const dir = await project(['build.gradle.kts'])
  const relative = dir.replace(/^\//, '')
  assert.equal((await detectProjectLang(relative)).lang, '', '相对路径拒绝')
  assert.equal((await detectProjectLang('')).lang, '', '空路径拒绝')
  assert.equal((await detectProjectLang('/'.repeat(MAX_CWD_CHARS + 1))).lang, '', '超长拒绝')
  assert.equal((await detectProjectLang(join(dir, 'nope-不存在'))).lang, '', '不存在的目录')
  assert.equal((await detectProjectLang(dir + '\u0000abc')).lang, '', 'NUL 字节拒绝')
  await rm(dir, { recursive: true, force: true })
})

test('安全边界：不跟随符号链接（标记文件是软链时不认）', async () => {
  const real = await project(['build.gradle.kts'])
  const linked = await mkdtemp(join(tmpdir(), 'mdr-proj-link-'))
  await symlink(join(real, 'build.gradle.kts'), join(linked, 'build.gradle.kts'))
  assert.equal((await detectProjectLang(linked)).lang, '', '软链标记文件不算数')
  await rm(real, { recursive: true, force: true })
  await rm(linked, { recursive: true, force: true })
})

test('不遍历目录：子目录里的标记文件不算（只看项目根）', async () => {
  const dir = await project(['app/build.gradle.kts'])
  assert.equal((await detectProjectLang(dir)).lang, '', '只看 cwd 根，不递归')
  await rm(dir, { recursive: true, force: true })
})

test('缓存：同一 cwd 第二次不再 stat（目录删掉后仍返回缓存值）；清缓存后重新探测', async () => {
  const dir = await project(['Cargo.toml'])
  assert.equal((await detectProjectLang(dir)).lang, 'rust', '首次探测')
  await rm(dir, { recursive: true, force: true })
  assert.equal((await detectProjectLang(dir)).lang, 'rust', 'TTL 内命中缓存（目录已删仍返回）')
  clearProjectLangCache()
  assert.equal((await detectProjectLang(dir)).lang, '', '清缓存后重新探测 → 目录没了')
})

test('常量：缓存上限与 TTL 有界（长会话不无界增长）', () => {
  assert.ok(Number.isInteger(CACHE_MAX) && CACHE_MAX > 0 && CACHE_MAX <= 128, '缓存条数有界')
  assert.ok(CACHE_TTL_MS > 0 && CACHE_TTL_MS <= 60 * 60 * 1000, 'TTL ≤ 1 小时')
  assert.equal(MAX_CWD_CHARS, 512, '路径长度上限')
  assert.ok(PROJECT_MARKERS.length > 8 && PROJECT_MARKERS.length <= 32, '标记清单有界')
})

test('cwdOfRequest：缺参数 / 非法 URL → 空串；重复参数取第一个', () => {
  assert.equal(cwdOfRequest({ url: '/md-render/api/project-lang' }), '', '缺参数')
  assert.equal(cwdOfRequest({ url: '/md-render/api/project-lang?cwd=%2Ftmp%2Fa&cwd=%2Ftmp%2Fb' }), '/tmp/a', '取第一个')
})

test('handler：GET → 200 + { ok, value }；非 GET → 405；探测异常退化为空结果', async () => {
  const dir = await project(['go.mod'])
  const handler = createProjectLangHandler()

  const ok = fakeResponse()
  await handler({ method: 'GET', url: '/md-render/api/project-lang?cwd=' + encodeURIComponent(dir) }, ok)
  assert.equal(ok.statusCode, 200, 'GET 200')
  assert.equal(ok.body.ok, true)
  assert.deepEqual(ok.body.value, { lang: 'go', evidence: 'go.mod' })

  const bad = fakeResponse()
  await handler({ method: 'POST', url: '/md-render/api/project-lang' }, bad)
  assert.equal(bad.statusCode, 405, '非 GET 405')

  const empty = fakeResponse()
  await handler({ method: 'GET', url: '/md-render/api/project-lang?cwd=' }, empty)
  assert.deepEqual(empty.body.value, { lang: '', evidence: '' }, '非法参数 → 空结果（不是 4xx）')
  await rm(dir, { recursive: true, force: true })
})
