#!/usr/bin/env node
/**
 * Docs consistency check — 防"新插件/新版本未同步文档"复发（审查发现项）。
 *
 * 检查（任一失败 exit 1，CI 强制）：
 *   1. 每个 plugins/<name>/package.json 的插件必须出现在：
 *      - 根 README.md 插件表（`| [<name>](plugins/<name>/README.md) | <version> |`）
 *      - docs/索引.md（模块条目）与 docs/<模块>/概述.md（模块目录）
 *      （AGENTS.md 精简后不再承载插件清单/版本行，插件↔文档一致性由 docs/索引.md 承担）
 *   2. 根 README 插件表版本与 package.json version 一致
 *   3. 每个 DSH 插件 README 安装章节含 npm 安装方式
 *      （`dsh plugin --profile web add <npm包名>`；agent preset 除外）
 *
 * 用法：node scripts/check-docs.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

// 插件名 → 模块信息：module=docs/ 目录名，display=索引.md 显示名，npm=发布包名
const MODULES = {
  'dsh-file-activity': {
    module: '文件活动追踪',
    display: '文件活动追踪',
    npm: 'dsh-file-activity',
  },
  'dsh-think-zh-expand': { module: '思考增强', display: '思考增强', npm: 'dsh-think-zh-expand' },
  'dsh-mermaid-render': {
    module: 'mermaid渲染',
    display: 'Mermaid 渲染',
    npm: 'dsh-mermaid-render',
  },
  'dsh-md-render': { module: 'md渲染', display: 'md 渲染', npm: 'dsh-md-render' },
  'dsh-my-notify': { module: '通知提醒', display: '通知提醒', npm: 'dsh-my-notify' },
  'dsh-my-guardian': { module: '插件治理', display: '插件治理', npm: 'dsh-my-guardian' },
  'dsh-task-reliability': {
    module: '任务可靠性',
    display: '任务可靠性',
    npm: 'dsh-task-reliability',
  },
  'dsh-my-skill-manager': {
    module: 'Skill管理',
    display: 'Skill 管理',
    npm: 'dsh-my-skill-manager',
  },
  'dsh-my-memory': { module: '记忆', display: '记忆', npm: 'dsh-my-memory' },
  'dsh-my-plugin-manager': {
    module: '插件管理',
    display: '插件管理',
    npm: 'dsh-my-plugin-manager',
  },
  'dsh-my-observability': { module: '可观测性', display: '可观测性', npm: 'dsh-my-observability' },
  'dsh-my-guard': { module: '安全护栏', display: '安全护栏', npm: 'dsh-my-guard' },
  'dsh-my-context': { module: '上下文透镜', display: '上下文透镜', npm: 'dsh-my-context' },
  'dsh-session-title-gen': {
    module: '会话标题自动生成',
    display: '会话标题自动生成',
    npm: 'dsh-session-title-gen',
  },
  'dsh-my-remote': { module: '远程控制', display: '远程控制', npm: 'dsh-my-remote' },
  'dsh-plugin-dev-mode': { module: '插件开发模式', display: '插件开发模式', npm: null }, // agent preset，非 npm 插件
  'dsh-ts-example': { module: 'TS示例', display: 'TS 示例插件', npm: 'dsh-ts-example' },
  'dsh-shared': { module: '共享工具包', display: '共享工具包', npm: 'dsh-shared' }, // 共享工具包（issue #45）
}

const readme = readFileSync(join(root, 'README.md'), 'utf8')
const index = readFileSync(join(root, 'docs', '索引.md'), 'utf8')

for (const entry of readdirSync(join(root, 'plugins'))) {
  const pkgPath = join(root, 'plugins', entry, 'package.json')
  if (!existsSync(pkgPath)) continue
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const meta = MODULES[entry]
  if (!meta) {
    errors.push(`✗ plugins/${entry} 未登记到 scripts/check-docs.mjs 的 MODULES 映射表`)
    continue
  }
  const { module, display, npm } = meta
  const version = pkg.version

  // 1a. 根 README 插件表
  // \s+ 容忍 prettier 表格列对齐填充的多空格（issue #44 引入 prettier 后，
  // markdown 表格单元格间按列宽填充空格，单空格正则匹配失败）
  const rowRe = new RegExp(`\\| \\[${entry}\\]\\(plugins/${entry}/README\\.md\\)\\s+\\| ${version} \\|`)
  if (!rowRe.test(readme)) {
    errors.push(`✗ 根 README.md 插件表缺少 ${entry} 行（或版本不是 ${version}）`)
  }
  // 1b. docs/索引.md + 模块目录
  if (!index.includes(`→ [${display}]`)) {
    errors.push(`✗ docs/索引.md 缺少「${display}」条目`)
  }
  if (!existsSync(join(root, 'docs', module, '概述.md'))) {
    errors.push(`✗ docs/${module}/概述.md 不存在`)
  }
  // 3. 安装章节含 npm 方式（agent preset 除外；共享工具包 dsh.kind=library 豁免——
  //    非 DSH 插件，无 cordis.patch.yml，`dsh plugin add` 不适用，随依赖方自动安装）
  if (npm && pkg.dsh?.kind !== 'library') {
    const plugReadme = readFileSync(join(root, 'plugins', entry, 'README.md'), 'utf8')
    if (!plugReadme.includes(`dsh plugin --profile web add ${npm}`)) {
      errors.push(`✗ plugins/${entry}/README.md 安装章节缺少 npm 方式（dsh plugin --profile web add ${npm}）`)
    }
  }
}

if (errors.length > 0) {
  console.error(`文档一致性检查失败（${errors.length} 项）：`)
  for (const e of errors) console.error('  ' + e)
  console.error('修复后重跑：node scripts/check-docs.mjs')
  process.exit(1)
}
console.log('✓ 文档一致性检查通过（插件 ↔ 根 README / AGENTS.md / docs/ 索引与模块 / 安装章节）')
