/**
 * verify-credentials.test.mjs — 隔离实例的凭据/provider 继承与启动前完整性自检（issue #403 防回归）。
 *
 * 复现的失败场景：verify-real-profile.mjs 只复刻 `<DSH_HOME>/profiles/<profile>/`，
 * 隔离 DSH_HOME 里**没有** `.credentials.yaml` 的 `refs:` 段、也没有 `settings.yaml` 的
 * provider 段 → 首轮真实模型调用直接
 * `MISSING_CREDENTIAL: llm-pi-ai: no credential for provider route "ollama-flash"`
 * （需人工把生产凭据补进隔离 DSH_HOME 才能继续验证）。
 *
 * 覆盖 scripts/lib/verify-credentials.mjs 的全部判据：
 *   parseCredentialRefs / parseEnvFile / collectProviderCredentialRefs /
 *   planCredentialInjection / renderCredentialReport / renderCredentialFailure /
 *   isInheritableSettingsSection / extractInheritableSettings /
 *   findPlaintextSecretHits / buildIsolatedSettings，
 * 外加脚本接线防漂移（lib 改了必须真的被 verify-real-profile.mjs 调用）。
 *
 * 安全边界（测试也是边界的一部分）：本文件只使用**假值**（`sk-test-…`），
 * 真实凭据绝不进夹具；并断言渲染结果与失败文案里**不出现任何凭据值**。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  buildIsolatedSettings,
  collectProviderCredentialRefs,
  decideLlmProbe,
  extractInheritableSettings,
  findPlaintextSecretHits,
  isInheritableSettingsSection,
  parseCredentialRefs,
  parseEnvFile,
  planCredentialInjection,
  renderCredentialFailure,
  renderCredentialReport,
  REQUIRED_PROBE_PATTERN,
} from '../lib/verify-credentials.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const scriptText = readFileSync(join(here, '..', 'verify-real-profile.mjs'), 'utf8')

const FAKE_DEEPSEEK = 'sk-test-fake-deepseek-value-0001'
const FAKE_OLLAMA = 'sk-test-fake-ollama-value-0002'

const CREDENTIALS_DOC = [
  'version: 1',
  'records:',
  '  client-connection/browser-session:',
  '    kind: browser-session',
  '    payload:',
  '      version: 1',
  '      secret: not-a-real-token',
  'refs:',
  `  DEEPSEEK_API_KEY: ${FAKE_DEEPSEEK}`,
  `  OLLAMA_FLASH_API_KEY: ${FAKE_OLLAMA}`,
  '',
].join('\n')

// 组合配置里 provider 段的形状（取自真实 dump-config，值全部为引用名）
const DUMP = [
  '- id: llm-pi-ai',
  "  name: '@deepseek-ai/dsh-llm-pi-ai'",
  '  config:',
  '    providers:',
  '      xiaomi-token-plan-cn:',
  '        apiKeyEnv: XIAOMI_TOKEN_PLAN_CN_API_KEY',
  '        models:',
  '          - id: deepseek-v4-flash',
  '      ollama-flash:',
  '        apiKeyEnv: OLLAMA_FLASH_API_KEY',
  '        baseURL: https://example.invalid/v1',
  '- id: llm-deepseek',
  "  name: '@deepseek-ai/dsh-llm-deepseek-api-key'",
  '  config:',
  '    apiKeyEnv: DEEPSEEK_API_KEY',
  '    models: []',
].join('\n')

describe('parseCredentialRefs（生产 .credentials.yaml 的 refs 段）', () => {
  it('解析 refs 段：键名与值成对取出，其余段（records）不受影响', () => {
    const { refs, errors } = parseCredentialRefs(CREDENTIALS_DOC)
    expect(errors).toEqual([])
    expect(Object.keys(refs)).toEqual(['DEEPSEEK_API_KEY', 'OLLAMA_FLASH_API_KEY'])
    expect(refs.DEEPSEEK_API_KEY).toBe(FAKE_DEEPSEEK)
  })

  it('records 段里的同名缩进键绝不被当成 ref（否则会把会话 secret 当 API key 注入）', () => {
    const { refs } = parseCredentialRefs(CREDENTIALS_DOC)
    expect(refs.secret).toBeUndefined()
    expect(refs.version).toBeUndefined()
    expect(refs.kind).toBeUndefined()
  })

  it('没有 refs 段（隔离实例自生成的凭据就是这种）→ 空表，不报错', () => {
    const { refs, errors } = parseCredentialRefs('version: 1\nrecords:\n  x:\n    kind: browser-session\n')
    expect(refs).toEqual({})
    expect(errors).toEqual([])
  })

  it('键名不是环境变量名 / 重复键 → 记入 errors（fail-closed，不静默丢弃）', () => {
    const bad = parseCredentialRefs('refs:\n  1BAD: x\n  OK_KEY: y\n')
    expect(bad.errors.length).toBe(1)
    expect(bad.errors[0]).toContain('1BAD')
    const dup = parseCredentialRefs('refs:\n  OK_KEY: a\n  OK_KEY: b\n')
    expect(dup.errors.length).toBe(1)
    expect(dup.errors[0]).toContain('OK_KEY')
  })

  it('空 / 非字符串输入不抛异常', () => {
    expect(parseCredentialRefs('').refs).toEqual({})
    expect(parseCredentialRefs(undefined).refs).toEqual({})
  })
})

describe('parseEnvFile（.env 兜底层）', () => {
  it('解析 KEY=VALUE，忽略注释与空行，去掉引号与 export 前缀', () => {
    const values = parseEnvFile(
      ['# comment', '', 'export FOO=bar', 'QUOTED="a b"', "SINGLE='c'", 'NOT_A_LINE', 'EMPTY='].join('\n'),
    )
    expect(values).toEqual({ FOO: 'bar', QUOTED: 'a b', SINGLE: 'c', EMPTY: '' })
  })
})

describe('collectProviderCredentialRefs（从 dump-config 提取 provider 段引用的凭据名）', () => {
  it('按 provider route 归位（route 名是 apiKeyEnv 上一级缩进的键），并合并同名引用', () => {
    const refs = collectProviderCredentialRefs(DUMP)
    expect(refs.map((item) => item.name)).toEqual([
      'XIAOMI_TOKEN_PLAN_CN_API_KEY',
      'OLLAMA_FLASH_API_KEY',
      'DEEPSEEK_API_KEY',
    ])
    const ollama = refs.find((item) => item.name === 'OLLAMA_FLASH_API_KEY')
    expect(ollama.routes).toEqual(['ollama-flash'])
    expect(ollama.entries).toEqual(['llm-pi-ai'])
  })

  it('同名引用出现在多处 → routes/entries 合并去重', () => {
    const twice = [DUMP, DUMP.replace('ollama-flash', 'ollama-flash-2')].join('\n')
    const ollama = collectProviderCredentialRefs(twice).find((item) => item.name === 'OLLAMA_FLASH_API_KEY')
    expect(ollama.routes).toEqual(['ollama-flash', 'ollama-flash-2'])
  })

  it('没有 apiKeyEnv（如 headless 模板未配置 provider）→ 空清单', () => {
    expect(collectProviderCredentialRefs('- id: x\n  name: y\n')).toEqual([])
    expect(collectProviderCredentialRefs('')).toEqual([])
  })
})

describe('planCredentialInjection（宿主优先级：继承环境变量 > 生产 refs）', () => {
  const required = collectProviderCredentialRefs(DUMP)

  it('启动环境变量已有 → 不注入（宿主的 inherited environment 优先级最高）', () => {
    const plan = planCredentialInjection({
      required: required.filter((item) => item.name === 'DEEPSEEK_API_KEY'),
      refs: {},
      env: { DEEPSEEK_API_KEY: FAKE_DEEPSEEK },
    })
    expect(plan.ok).toBe(true)
    expect(Object.keys(plan.inject)).toEqual([])
    expect(plan.resolved.find((item) => item.name === 'DEEPSEEK_API_KEY').source).toBe('启动环境变量')
  })

  it('生产 refs 有 → 注入计划携带该值（只经子进程环境变量，不落盘）', () => {
    const { refs } = parseCredentialRefs(CREDENTIALS_DOC)
    const plan = planCredentialInjection({ required, refs, env: {} })
    expect(plan.ok).toBe(false) // XIAOMI / 其它两个之外仍缺 XIAOMI_TOKEN_PLAN_CN_API_KEY
    expect(plan.inject.DEEPSEEK_API_KEY).toBe(FAKE_DEEPSEEK)
    expect(plan.inject.OLLAMA_FLASH_API_KEY).toBe(FAKE_OLLAMA)
    expect(plan.missing.map((item) => item.name)).toEqual(['XIAOMI_TOKEN_PLAN_CN_API_KEY'])
    expect(plan.resolved.find((item) => item.name === 'DEEPSEEK_API_KEY').source).toContain('.credentials.yaml')
  })

  it('全部来源都没有 → missing 带 route/entry（供错误文案点名"缺哪个字段、哪个 provider 在用"）', () => {
    const plan = planCredentialInjection({ required, refs: {}, env: {} })
    expect(plan.ok).toBe(false)
    expect(plan.missing.map((item) => item.name)).toEqual([
      'XIAOMI_TOKEN_PLAN_CN_API_KEY',
      'OLLAMA_FLASH_API_KEY',
      'DEEPSEEK_API_KEY',
    ])
    expect(plan.missing[1].routes).toEqual(['ollama-flash'])
    expect(plan.missing[1].entries).toEqual(['llm-pi-ai'])
  })

  it('required 为空（该 profile 不引用任何凭据）→ 视为通过，不误报', () => {
    const plan = planCredentialInjection({ required: [], refs: {}, env: {} })
    expect(plan.ok).toBe(true)
    expect(plan.missing).toEqual([])
  })

  it('空值环境变量不算已配置（与宿主"not set"语义一致）', () => {
    const plan = planCredentialInjection({
      required: [{ name: 'DEEPSEEK_API_KEY', routes: ['x'], entries: ['y'] }],
      refs: {},
      env: { DEEPSEEK_API_KEY: '' },
    })
    expect(plan.ok).toBe(false)
  })
})

describe('报告渲染：只含字段名与来源，绝不含凭据值', () => {
  const required = collectProviderCredentialRefs(DUMP)
  const { refs } = parseCredentialRefs(CREDENTIALS_DOC)
  const plan = planCredentialInjection({ required, refs, env: {} })

  it('通过/失败文案都不泄漏值', () => {
    const lines = [...renderCredentialReport(plan), ...renderCredentialFailure(plan.missing)]
    const text = lines.join('\n')
    expect(lines.length).toBeGreaterThan(0)
    expect(text).not.toContain(FAKE_DEEPSEEK)
    expect(text).not.toContain(FAKE_OLLAMA)
    expect(text).toContain('OLLAMA_FLASH_API_KEY')
    expect(text).toContain('ollama-flash')
  })

  it('失败文案给出补法（环境变量 / Models 页面写入生产凭据），而不是延迟到 MISSING_CREDENTIAL', () => {
    const text = renderCredentialFailure(plan.missing).join('\n')
    expect(text).toContain('MISSING_CREDENTIAL')
    expect(text).toMatch(/export .*XIAOMI_TOKEN_PLAN_CN_API_KEY/)
  })
})

describe('settings.yaml provider 段继承（按需 + 遮蔽）', () => {
  const HOST_SETTINGS = [
    'ui-theme:',
    '  preference: dark',
    'agent-default-model:',
    '  provider: ollama-flash',
    '  model: deepseek-v4.1-flash:cloud',
    'llm-pi-ai:',
    '  providers:',
    '    ollama-flash:',
    '      apiKeyEnv: OLLAMA_FLASH_API_KEY',
    'ui-chat:',
    '  transcriptView: compact',
    'llm-deepseek:',
    '  models: []',
    '',
  ].join('\n')

  it('段白名单：只认 llm-* 与 agent-default-model（ui-* 等生产偏好不带进隔离实例）', () => {
    expect(isInheritableSettingsSection('llm-pi-ai')).toBe(true)
    expect(isInheritableSettingsSection('agent-default-model')).toBe(true)
    expect(isInheritableSettingsSection('ui-theme')).toBe(false)
    expect(isInheritableSettingsSection('dsh-better-sidebar')).toBe(false)
  })

  it('提取时只保留白名单段原文（注释与格式逐字节保留），并回报段名', () => {
    const { text, sections } = extractInheritableSettings(HOST_SETTINGS)
    expect(sections).toEqual(['agent-default-model', 'llm-pi-ai', 'llm-deepseek'])
    expect(text).toContain('provider: ollama-flash')
    expect(text).not.toContain('ui-theme')
    expect(text).not.toContain('dark')
  })

  it('apiKeyEnv 引用名不算明文密钥；写成 sk-… 明文即命中（fail-closed）', () => {
    expect(findPlaintextSecretHits('      apiKeyEnv: OLLAMA_FLASH_API_KEY')).toEqual([])
    const hits = findPlaintextSecretHits('      apiKey: sk-test-fake-0003')
    expect(hits.length).toBe(1)
    expect(hits[0].field).toBe('apiKey')
    expect(JSON.stringify(hits)).not.toContain('sk-test-fake-0003')
  })

  it('生产有 settings.yaml → 隔离实例得到 provider 段；生产没有 → 空操作，不改既有文件', () => {
    const inherited = buildIsolatedSettings({ hostSettingsText: HOST_SETTINGS })
    expect(inherited.ok).toBe(true)
    expect(inherited.sections).toEqual(['agent-default-model', 'llm-pi-ai', 'llm-deepseek'])
    expect(inherited.text).toContain('OLLAMA_FLASH_API_KEY')
    const none = buildIsolatedSettings({ hostSettingsText: '' })
    expect(none.ok).toBe(true)
    expect(none.text).toBe('')
    expect(none.sections).toEqual([])
  })

  it('模型段里出现明文密钥 → blocked（拒绝把生产密钥抄进隔离实例）', () => {
    const leaky = HOST_SETTINGS.replace('apiKeyEnv: OLLAMA_FLASH_API_KEY', 'apiKey: sk-test-fake-0004')
    const built = buildIsolatedSettings({ hostSettingsText: leaky })
    expect(built.ok).toBe(false)
    expect(built.blocked.length).toBe(1)
    expect(JSON.stringify(built)).not.toContain('sk-test-fake-0004')
  })
})

describe('decideLlmProbe（真实模型调用探针判定）', () => {
  it('成功：exit 0 + 非空输出', () => {
    const verdict = decideLlmProbe({ code: 0, stdout: 'PONG\n', stderr: '' })
    expect(verdict.ok).toBe(true)
    expect(verdict.excerpt).toBe('PONG')
  })

  it('MISSING_CREDENTIAL → 失败且点名归因（凭据问题，不是插件缺陷）', () => {
    const verdict = decideLlmProbe({
      code: 0,
      stdout: '',
      stderr: 'dsh: MISSING_CREDENTIAL: llm-pi-ai: no credential for provider route "ollama-flash"',
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('MISSING_CREDENTIAL')
    expect(verdict.reason).toContain('不是插件缺陷')
  })

  it('退出码非 0 / stdout 为空 → 失败（"调用了但没回"不算可用）', () => {
    expect(decideLlmProbe({ code: 1, stdout: 'x' }).ok).toBe(false)
    expect(decideLlmProbe({ code: 0, stdout: '   ' }).ok).toBe(false)
  })
})

describe('脚本接线防漂移（lib 改了必须真的被 verify-real-profile.mjs 调用）', () => {
  it('启动前自检 + 环境变量注入 + settings 继承 + 真实调用探针都在脚本里接线', () => {
    for (const symbol of [
      'planCredentialInjection',
      'collectProviderCredentialRefs',
      'renderCredentialFailure',
      'renderCredentialReport',
      'buildIsolatedSettings',
      'parseCredentialRefs',
    ]) {
      expect(scriptText).toContain(symbol)
    }
    expect(REQUIRED_PROBE_PATTERN.test(scriptText)).toBe(true)
  })

  it('注入只走子进程环境变量（脚本把注入项并入 spawn 的 env）', () => {
    // 正向接线断言。刻意**不**写"源码里没有 writeFileSync(.credentials.yaml)"这类负向字面量
    // 断言：重构即假红（main 上 verify-profile 用例的实测教训）。
    // 「凭据不落盘、不打印」的契约由本文件的纯函数用例保证：inject 只承载值、
    // 渲染文案不含值、settings 继承拒绝明文密钥。
    expect(scriptText).toContain('...injectedEnv')
  })
})
