/**
 * 极简 GitHub Actions workflow 解析（issue #330）——只取 parity 校验需要的结构：
 *   job 名 → steps[]（每个 step 的 name / run / uses / continue-on-error）。
 *
 * 为什么不直接用 yaml 包：`yaml` 是**传递依赖**（vitest 依赖链带来），本仓库并未声明它。
 * 门禁脚本跨 CI/本地运行，不该依赖一个未声明、随时可能消失的包。而这里需要的结构极浅
 * （两级缩进 + `- ` 列表项），十几行解析即可，且能被单测钉死（scripts/test/gate-parity.test.mjs）。
 *
 * 支持的 YAML 子集（够用即止）：
 *   · `jobs:` 顶格；job 名 2 空格缩进
 *   · step 列表项 `      - `（6 空格），行内字段 `- name: x`
 *   · step 字段 `        key: value`（8 空格）：name / uses / run / continue-on-error（其余忽略）
 *   · run 的块标量 `        run: |`（其后缩进更深的行按行拼接）
 */

const JOB_RE = /^ {2}([A-Za-z0-9_-]+): *$/
const STEP_RE = /^ {6}- (.*)$/
const FIELD_RE = /^ {8}([A-Za-z0-9_-]+):(.*)$/
const INLINE_FIELD_RE = /^([A-Za-z0-9_-]+):(.*)$/

/** 剥掉行尾 YAML 注释（` # ...`；不处理引号内的 #，本文件用不到）。 */
function stripComment(text) {
  const idx = text.indexOf(' #')
  return (idx >= 0 ? text.slice(0, idx) : text).trim()
}

/** 去掉 `'...'` / `"..."` 包裹。 */
function unquote(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * 解析 workflow 文本，返回 `{ jobs: [{ name, steps: [{ name, run, uses }] }] }`。
 * run 为块标量时其多行内容用 `\n` 连接（便于对命令做子串匹配）。
 */
export function parseWorkflow(text) {
  const jobs = []
  let inJobs = false
  let job = null
  let step = null
  let block = null // { indent, lines }：正在收集的块标量

  const endBlock = () => {
    if (block && step && block.key === 'run') step.run = block.lines.join('\n').trim()
    block = null
  }
  const endStep = () => {
    endBlock()
    if (step && job) job.steps.push(step)
    step = null
  }
  const endJob = () => {
    endStep()
    if (job) jobs.push(job)
    job = null
  }
  const handleField = (key, rest, indent) => {
    const value = rest.trim()
    if ((value === '|' || value === '>') && key === 'run' && step) {
      block = { indent, lines: [], key: 'run' }
      return
    }
    const val = unquote(stripComment(value))
    if (!step) return
    if (key === 'name') step.name = val
    else if (key === 'uses') step.uses = val
    else if (key === 'run') step.run = val
    else if (key === 'continue-on-error') step.continueOnError = val === 'true' // issue #350：上报类步骤不得判红
  }

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length

    if (block) {
      if (indent > block.indent) {
        block.lines.push(line.trim())
        continue
      }
      endBlock()
    }

    if (/^jobs: *$/.test(line)) {
      inJobs = true
      continue
    }
    if (!inJobs) continue
    if (indent === 0) {
      endJob()
      inJobs = false
      continue
    }

    const jobMatch = line.match(JOB_RE)
    if (jobMatch) {
      endJob()
      job = { name: jobMatch[1], steps: [] }
      continue
    }
    if (!job) continue

    const stepMatch = line.match(STEP_RE)
    if (stepMatch) {
      endStep()
      step = { name: '', run: '', uses: '', continueOnError: false }
      const inline = stepMatch[1]
      const inlineField = inline.match(INLINE_FIELD_RE)
      if (inlineField) handleField(inlineField[1], inlineField[2], indent)
      continue
    }
    if (!step) continue

    const fieldMatch = line.match(FIELD_RE)
    if (fieldMatch) handleField(fieldMatch[1], fieldMatch[2], indent)
  }
  endJob()
  return { jobs }
}

/** 取某个 job；不存在返回 null。 */
export function findJob(parsed, name) {
  return parsed.jobs.find((j) => j.name === name) ?? null
}

/** 取某 job 下第一个 name 含 `needle` 的步骤；找不到返回 null。 */
export function findStep(parsed, jobName, needle) {
  const job = findJob(parsed, jobName)
  if (!job) return null
  return job.steps.find((s) => s.name.includes(needle)) ?? null
}

/** 该步骤执行的「命令文本」：run 脚本，或 `uses: <action>`（用于白名单匹配）。 */
export function stepCommand(step) {
  return step.run ? step.run : step.uses
}
