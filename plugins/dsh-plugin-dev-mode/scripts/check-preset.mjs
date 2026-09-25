#!/usr/bin/env node
/**
 * check-preset.mjs — this bundle's preset declaration is structurally sound and
 * still says what it used to say.
 *
 * Since DSH 0.1.7 an agent preset is an `@deepseek-ai/dsh-agent-preset` row in a
 * bundle patch, installed through `plugin_manager` (`install_bundle`), not a
 * directory under `$DSH_HOME/.agent-presets/`. This script is the regression
 * guard for that shape: it reads `cordis.patch.yml` and `package.json` and
 * asserts the declaration the host would consume, plus the invariants that keep
 * the retired directory form from creeping back.
 *
 * Deliberately dependency-free: the repository root declares no `yaml` of its
 * own (it only arrives transitively) and plugin directories have no
 * `node_modules` of their own, so parsing would ride an undeclared, movable
 * dependency. Structure is read by indentation instead — the declaration layout
 * is fixed by the `preset-<id>` row convention — and `scripts/lib/preset-gate.mjs`
 * guards the same shape on the release side.
 *
 * Run: node scripts/check-preset.mjs   (also `npm test`)
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const fail = (message) => problems.push(message)

/** The declared preset's plugin rows, in order — the former `agent.cordis.yml` list. */
const EXPECTED_ROWS = [
  'persona',
  'agent-instructions',
  'tool-bash',
  'tool-pwsh',
  'tool-fs',
  'tool-fs-search',
  'tool-jobs',
  'tool-goal',
  'compaction',
  'skill-filesystem',
  'tool-skill',
  'tool-ask-user',
  'tool-todo',
  'tool-cordis',
]
/** Rows nested inside the `compaction` group, in order. */
const EXPECTED_GROUP_ROWS = ['compaction-basic', 'command-compact', 'tool-result-pruner']
/** Loader row id convention: `preset-<id>`. */
const EXPECTED_LOADER_ID = 'preset-plugin-dev'
/** The preset's own id, taken from the retired `.agent-presets/<id>/` directory name. */
const EXPECTED_PRESET_ID = 'plugin-dev'

const read = (file) => (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : null)
const indentOf = (line) => line.length - line.trimStart().length
/** Plugin-row ids at one indentation depth, in file order. */
const rowIdsAt = (text, indent) =>
  text
    .split('\n')
    .filter((line) => indentOf(line) === indent && /^-\s*id:\s*[a-z0-9-]+\s*$/.test(line.trim()))
    .map((line) => line.trim().replace(/^-\s*id:\s*/, ''))
/** Value of a `key:` line at one indentation depth (`null` when absent). */
const valueAt = (text, indent, key) => {
  const line = text
    .split('\n')
    .find((candidate) => indentOf(candidate) === indent && candidate.trim().startsWith(`${key}:`))
  return line === undefined
    ? null
    : line
        .trim()
        .slice(key.length + 1)
        .trim()
}

// ── package.json: the bundle manifest ────────────────────────────────────────
const pkgText = read('package.json')
const pkg = pkgText === null ? {} : JSON.parse(pkgText)
const dsh = pkg.dsh ?? {}

if (dsh.kind !== 'preset')
  fail(`package.json dsh.kind must be "preset" (declares dsh.presetReason), got ${JSON.stringify(dsh.kind)}`)
if (typeof dsh.presetReason !== 'string' || dsh.presetReason.trim() === '')
  fail('package.json dsh.presetReason must be a non-empty string')
if (dsh.bundle?.patch !== './cordis.patch.yml') {
  fail(
    `package.json dsh.bundle.patch must be "./cordis.patch.yml" (install_bundle refuses a package that declares no dsh.bundle), got ${JSON.stringify(dsh.bundle?.patch)}`,
  )
}
if (dsh.client !== undefined) fail('package.json dsh.client must stay unset: a preset injects nothing into the browser')
const files = pkg.files ?? []
if (!files.includes('cordis.patch.yml'))
  fail('package.json files must ship cordis.patch.yml (the bundle patch is the deliverable)')
// The README's effect screenshot must stay in the published file set.
if (!files.some((entry) => entry === 'assets' || entry.startsWith('assets/')))
  fail('package.json files must ship assets/ (the README screenshot is a pack-hygiene requirement)')

// ── cordis.patch.yml: the declaration the host consumes ──────────────────────
const patch = read('cordis.patch.yml')
if (patch === null) {
  fail('cordis.patch.yml is missing — it is the bundle patch that declares the preset')
} else {
  const body = patch
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')

  // Layer 0: the top-level `- insert:` patch op.
  const firstLine = body.split('\n').find((line) => line.trim() !== '') ?? ''
  if (indentOf(firstLine) !== 0 || !/^-\s*insert:\s*$/.test(firstLine.trim())) {
    fail('cordis.patch.yml must open with a top-level `- insert:` patch op')
  }

  // Layer 1: the declaration row (`id` at 4, `name`/`config` at 6).
  const loaderIds = rowIdsAt(body, 4)
  if (loaderIds.length !== 1)
    fail(`cordis.patch.yml must insert exactly one declaration row, found ${String(loaderIds.length)}`)
  if (loaderIds[0] !== EXPECTED_LOADER_ID) {
    fail(
      `declaration row id must be "${EXPECTED_LOADER_ID}" (preset-<id> convention), got ${JSON.stringify(loaderIds[0] ?? null)}`,
    )
  }
  if (valueAt(body, 6, 'name') !== "'@deepseek-ai/dsh-agent-preset'") {
    fail(
      `declaration row name must be '@deepseek-ai/dsh-agent-preset', got ${JSON.stringify(valueAt(body, 6, 'name'))}`,
    )
  }

  // Layer 2: the preset's own config (`id`/`name`/`description` at 8).
  if (valueAt(body, 8, 'id') !== EXPECTED_PRESET_ID) {
    fail(`config.id must be "${EXPECTED_PRESET_ID}", got ${JSON.stringify(valueAt(body, 8, 'id'))}`)
  }
  for (const key of ['name', 'description']) {
    const value = valueAt(body, 8, key)
    if (value === null || value === '') fail(`config.${key} must be a non-empty string (roster display metadata)`)
  }
  // The retired preset.yml carried no roster order; inventing one here would
  // silently move the preset in the picker (an unset order sorts last).
  if (valueAt(body, 8, 'order') !== null) {
    fail(
      `config.order must stay unset (the retired preset.yml declared none), got ${JSON.stringify(valueAt(body, 8, 'order'))}`,
    )
  }

  // Layer 3: the plugin list (`- id` at 10) and the compaction group's rows (at 14).
  const rows = rowIdsAt(body, 10)
  if (rows.join(' > ') !== EXPECTED_ROWS.join(' > ')) {
    fail(
      `config.plugins must keep the former agent.cordis.yml rows verbatim:\n    expected: ${EXPECTED_ROWS.join(' > ')}\n    actual:   ${rows.join(' > ')}`,
    )
  }
  const group = rowIdsAt(body, 14)
  if (group.join(' > ') !== EXPECTED_GROUP_ROWS.join(' > ')) {
    fail(`the compaction group must keep its former rows, got: ${group.join(' > ')}`)
  }

  // persona: `@deepseek-ai/dsh-persona` requires `prefix`; the former `text` was removed.
  if (/(^|\n)\s*text:\s*\S/.test(body)) {
    fail(
      'persona config must not use `text` — @deepseek-ai/dsh-persona took `prefix`/`suffix` and would fail activation',
    )
  }
  const lines = body.split('\n')
  const prefixIndex = lines.findIndex((line) => indentOf(line) === 14 && line.trim().startsWith('prefix:'))
  const prefixValue = prefixIndex === -1 ? null : lines[prefixIndex].trim().slice('prefix:'.length).trim()
  // A block scalar (`|-` / `>-`) carries its text on the following lines.
  const blockScalar = ['|', '|-', '>', '>-'].includes(prefixValue ?? '')
  const prefixBody =
    prefixIndex === -1
      ? ''
      : blockScalar
        ? (lines.slice(prefixIndex + 1).find((line) => line.trim() !== '') ?? '')
        : (prefixValue ?? '')
  if (prefixBody === '') fail('persona config.prefix must be a non-empty string (the former persona text)')
  for (const variable of ['{{model}}', '{{cwd}}']) {
    if (!body.includes(variable)) fail(`persona config.prefix must interpolate ${variable}`)
  }

  // skills: baseUrl is the declaration plugin's package, not this bundle's directory.
  if (!body.includes('@deepseek-ai/dsh-agent-preset/package.json')) {
    fail(
      'skill-filesystem customSkillDirs must resolve @deepseek-ai/dsh-agent-preset (baseUrl is that package, not a preset directory)',
    )
  }
}

// ── the retired directory form must not creep back ───────────────────────────
// DSH 0.1.7 reads no `.agent-presets/` directory: keeping these files would ship
// assets that silently do nothing (and a copied `skills/` tree would still teach
// the removed mechanism).
for (const retired of ['agent.cordis.yml', 'preset.yml', 'scripts/install.mjs', 'skills']) {
  if (existsSync(path.join(root, retired))) {
    fail(
      `${retired} is retired: nothing reads \`.agent-presets/\` any more — install this bundle with plugin_manager install_bundle`,
    )
  }
}

if (problems.length > 0) {
  console.error(`✗ preset declaration check failed (${String(problems.length)}):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('✓ 插件开发模式 preset 声明校验通过')
console.log(`  载体：bundle patch（cordis.patch.yml）→ 声明行 ${EXPECTED_LOADER_ID}（@deepseek-ai/dsh-agent-preset）`)
console.log(
  `  preset id=${EXPECTED_PRESET_ID} · plugins ${String(EXPECTED_ROWS.length)} 行（含 compaction 组 3 行）· name/description 保留原 preset.yml 文案`,
)
