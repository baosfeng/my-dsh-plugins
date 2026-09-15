/**
 * fork-pool.mjs — fork 池的纯函数件（issue #240）。
 *
 * 为什么需要它：fork 池的创建/清理在过去是 skills/dsh-github-triage/SKILL.md 里的**手工 5 步 +
 * 手工软链 node_modules**。手工步骤有两类代价：① 每次子任务都要重敲一遍（本仓库已发生几十次）；
 * ② 更容易漏掉隐性前置——实测发现 fork 里 commit / push **完全不触发 pre-commit / pre-push**：
 *    · `git clone --local` 只复制 refs 与对象库，**不复制 .git/config**，主工作区的
 *      `core.hooksPath=.husky/_` 是 local config，因此必然带不进 fork；
 *    · `.husky/_/` 自身带 `.gitignore`（内容 `*`），clone 天然没有；
 *    · 根 `prepare: husky` 只在 `npm install` 时执行，而 fork 的 node_modules 是软链，
 *      从未 npm install —— 于是 `_` 永远不生成。
 *    结果：子 agent 的格式/校验错误直接漏到 CI（PR #239 的 prettier 红盘即此），
 *    一轮 CI 白跑 ~80s 再加重推定位，正是 owner 说的"每个子 agent 都要耽搁时间"。
 *
 * 本模块**只做纯计算**（不读盘、不跑命令），便于单测；IO 侧在 scripts/fork-pool.mjs。
 */

/** fork 编号：允许 123 / 240b / dx 这类短标识，但禁止任何路径分隔与相对路径片段。 */
const FORK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/

/** 分支名：宽松但同样禁止空白与路径穿越。 */
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/

/**
 * node_modules 里**必须建成真实目录**的条目：它们是测试运行时的写目标（vitest / vite 缓存）。
 * 其余 658 个包逐条软链回主工作区，既不重复占盘，也不会被并行 agent 互相污染。
 *
 * ⚠️ 别把它们和 workspace 内部包（dsh-shared 等）混为一谈：这三个是**缓存目录**，
 * 必须真实是因为多个 agent 并行时共用同一份 .vite/.cache 会互相踩
 * （见 docs/踩坑/README.md）；内部包必须指向 fork 内则是为了
 * **避免假验证**（见 planWorkspaceLinks）。两者解决的是不同问题。
 */
export const WRITABLE_NODE_MODULES_ENTRIES = ['.cache', '.vite', '.vite-temp']

/** node_modules 就位策略：symlink（逐包软链，默认）/ copy（APFS clonefile）/ none。 */
export const NODE_MODULES_MODES = ['symlink', 'copy', 'none']

/**
 * fork 内本地校验必须能解析到的可执行文件（缺一个，"本地全绿"就不可信）。
 * 为什么单列这条：node_modules 里的 `.bin` 是**隐藏目录**，用 shell 的
 * `for d in node_modules/*` 建软链会整条漏掉（glob 默认不匹配 `.` 开头的名字），
 * 于是 `npx --no-install vitest` 解析失败 —— 表现为 verify-local 里若干检查项报错，
 * 极易被误读成"我的代码有问题"。这是比 hook 缺失更隐蔽的一类环境坑。
 */
export const REQUIRED_TOOLS = ['vitest', 'depcruise', 'prettier', 'eslint', 'cucumber-js']

export function isValidForkId(id) {
  return FORK_ID_RE.test(String(id ?? ''))
}

export function isValidBranchName(name) {
  const text = String(name ?? '')
  return BRANCH_RE.test(text) && !text.includes('..') && !text.endsWith('/')
}

/** fork 目录 = <tmpRoot>/gh-fork-<编号>；编号非法直接抛错（绝不拼接可疑路径）。 */
export function forkDirFor(id, tmpRoot = '/tmp') {
  if (!isValidForkId(id)) throw new Error(`非法 fork 编号：${id}（只允许字母数字与 . _ -，且以字母数字开头）`)
  return joinPosix(tmpRoot, `gh-fork-${id}`)
}

/** 分支名默认 fix/<编号>（一个子任务 = 一个分支 = 一个 PR）。 */
export function branchNameFor(id, override) {
  if (override) {
    if (!isValidBranchName(override)) throw new Error(`非法分支名：${override}`)
    return override
  }
  if (!isValidForkId(id)) throw new Error(`非法 fork 编号：${id}`)
  return `fix/${id}`
}

/** 极简 POSIX 路径拼接：只处理斜杠，避免为一个字符串操作引入 path 依赖（也便于跨平台单测）。 */
function joinPosix(left, right) {
  return `${String(left).replace(/\/+$/, '')}/${String(right).replace(/^\/+/, '')}`
}

/**
 * 从 git remote URL 解析 owner/repo。支持 https 与 SSH 两种写法（仓库用 https 拉、SSH 推，
 * 两种都必须能解析，否则 fork 创建到一半才发现推不上去）。
 */
export function parseOwnerRepo(remoteUrl) {
  const text = String(remoteUrl ?? '').trim()
  if (!text) return null
  const scpLike = /^[a-z0-9._-]+@([^:]+):(.+)$/i.exec(text)
  const raw = scpLike ? scpLike[2] : text.replace(/^[a-z]+:\/\//i, '').replace(/^[^/]*@?[^/]*\//, '')
  const path = (scpLike ? raw : raw)
    .replace(/^\/+/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 2) return null
  return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] }
}

/** fetch 走 https + 代理（本机唯一可靠下行通路）；push 走 SSH（不经代理，代理挂了也能推）。 */
/**
 * 远端是否为「本地，不依赖网络」（issue #346）：本地路径 / `file://` → true；
 * http(s):// · git:// · ssh:// · scp 式 `user@host:path` → false（这些要走远端规范化）。
 *
 * 为什么单独成纯函数：`parseOwnerRepo` 对任何 `a/b` 形态都会给出 owner/repo，所以
 * "要不要拼 github.com URL"必须靠这个判据，而不能靠 parseOwnerRepo 是否返回 null。
 */
export function isLocalRemote(remoteUrl) {
  const text = String(remoteUrl ?? '').trim()
  if (text === '') return false
  if (/^file:\/\//i.test(text)) return true
  return !/^(?:https?|git|ssh):\/\//i.test(text) && !/^[a-z0-9._-]+@[^:]+:/i.test(text)
}

export const fetchRemoteFor = (owner, repo) => `https://github.com/${owner}/${repo}.git`
export const pushRemoteFor = (owner, repo) => `git@github.com:${owner}/${repo}.git`

/**
 * `.git/info/exclude` 的追加内容：已含 node_modules 时返回 null（幂等）。
 *
 * 为什么抽成纯函数：这段判据一旦写错，`git add -A` 就会把 node_modules 软链提交进仓库
 * （node_modules/ 规则**不匹配软链**，见 ensureExclude 的注释），必须能被单测直接覆盖。
 */
export function excludeAppendContent(current) {
  const text = String(current ?? '')
  if (text.split('\n').includes('node_modules')) return null
  return `${text.replace(/\n?$/, '\n')}node_modules\n`
}

/**
 * 基线判定：fork 拿到的 origin/<base> 必须与 GitHub 上 refs/heads/<base> 一致。
 * 历史踩坑（docs/踩坑/README.md）：clone --local 的 origin/<base> 其实是
 * **主工作区本地分支**（clone 把源 refs/heads/* 映射成目标 refs/remotes/origin/*，但不复制
 * remote-tracking refs），主工作区又只 fetch 不 merge —— 于是 fork 常常拿到过期基线，
 * 之后 PR 里混进无关差异。这里把判定固化成显式门禁。
 */
export function evaluateBaseline(forkSha, remoteSha) {
  const a = String(forkSha ?? '').trim()
  const b = String(remoteSha ?? '').trim()
  if (!a || !b) {
    // 「查不到」与「查到了但不一致」必须分开：代理挂掉时把 check 判死，会让人误以为分支有问题。
    return { ok: false, stale: null, reason: '无法比对（远端 SHA 查询失败——多半是网络/代理问题，不一定是分支过期）' }
  }
  if (a !== b) {
    return {
      ok: false,
      stale: true,
      reason: `fork 基线过期：fork=${a.slice(0, 8)} 远端=${b.slice(0, 8)}（需要 git fetch origin <base> 后重新起分支）`,
    }
  }
  return { ok: true, stale: false, reason: `基线一致（${a.slice(0, 8)}）` }
}

/** 归一化路径（去掉重复斜杠与 . / .. 片段），用于清理前的安全判定。 */
export function normalizePath(input) {
  const absolute = String(input ?? '').startsWith('/')
  const out = []
  for (const seg of String(input ?? '').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      out.pop()
      continue
    }
    out.push(seg)
  }
  return `${absolute ? '/' : ''}${out.join('/')}`
}

/**
 * 清理安全判定：只允许删除 <tmpRoot>/gh-fork-* 这一层。
 * 为什么单列：`rm -rf` 是不可逆动作，而它的入参来自命令行 —— 一个 `clean /Users/me/IdeaProjects/...`
 * 就足以毁掉主工作区。这里用「先归一化再去掉 .. 影响」的判据把范围钉死。
 */
export function isSafeToClean(dir, tmpRoot = '/tmp') {
  const target = normalizePath(dir)
  const root = normalizePath(tmpRoot)
  const prefix = `${root}/`
  if (!target.startsWith(prefix)) return false
  const rest = target.slice(prefix.length)
  if (rest.includes('/')) return false
  return /^gh-fork-[A-Za-z0-9._-]+$/.test(rest)
}

/** create 的步骤清单（纯数据，供 CLI 执行与单测断言"一步都不能少"）。 */
export function planCreateSteps({ hooks = true, nodeModules = 'symlink' } = {}) {
  const steps = [
    { id: 'clone', label: '克隆（git clone --local，零网络）' },
    { id: 'remote', label: '分流 remotes（fetch=https+代理 / push=SSH）' },
    { id: 'fetch', label: '拉取远端基线（git fetch origin <base>）' },
    { id: 'baseline', label: '基线校验（与 git ls-remote 比对 SHA）' },
    { id: 'branch', label: '建工作分支（checkout -b <branch> origin/<base>）' },
    { id: 'exclude', label: '写 .git/info/exclude（防 node_modules 软链被 git add -A 误提交）' },
  ]
  if (nodeModules === 'symlink' || nodeModules === 'copy') {
    steps.push({
      id: 'node_modules',
      label: `node_modules 就位（${nodeModules === 'copy' ? 'APFS clonefile 全量克隆' : '逐包软链 + 3 个可写真实目录'}）`,
    })
  }
  if (nodeModules === 'symlink' || nodeModules === 'copy') {
    steps.push({
      id: 'workspace-links',
      label: 'workspace 内部包重指向（dsh-shared 等必须指向本 fork，否则验证的是主工作区的旧包）',
    })
  }
  if (hooks) steps.push({ id: 'hooks', label: '安装 git hooks（恢复 pre-commit / pre-push 门禁）' })
  return steps
}

/**
 * 推送前自检项。每项都带「结论 + 证据」，便于人不看日志也能判读。
 * fatal=true 的项失败即判定"不可推送"；否则只提示。
 */
export function buildCheckItems({
  forkExists,
  hooksPath,
  hooksWired,
  toolchain = null,
  workspaceLinks = null,
  baselineIntegrity = null,
  baseline,
  stagedNodeModules = [],
} = {}) {
  const items = []
  items.push({
    id: 'fork',
    ok: Boolean(forkExists),
    fatal: true,
    label: 'fork 目录存在',
    detail: forkExists ? '已就位' : '缺失（先跑 fork-pool create）',
  })
  items.push({
    id: 'hooks',
    ok: Boolean(hooksWired),
    fatal: false,
    label: 'git hooks 已挂载（pre-commit / pre-push）',
    detail: hooksWired
      ? `core.hooksPath=${hooksPath || '.husky/_'}`
      : '未挂载 —— 提交/推送不会跑本地门禁（用 fork-pool create 重建，或 ./node_modules/.bin/husky + git config core.hooksPath .husky/_ 抢救）',
  })
  if (toolchain) {
    items.push({
      id: 'toolchain',
      ok: toolchain.ok,
      fatal: true,
      label: '工具链可解析（本地校验结论可信）',
      detail: toolchain.ok
        ? `node_modules/.bin 完整（${REQUIRED_TOOLS.join(' / ')}）`
        : `缺少 .bin/${toolchain.missing.join('、.bin/')} —— 多半是建软链时用了 shell glob（node_modules/* 会漏掉隐藏的 .bin）；用 fork-pool create 重建即可`,
    })
  }
  if (workspaceLinks) {
    items.push({
      id: 'workspace-links',
      ok: workspaceLinks.ok,
      fatal: true,
      label: 'workspace 内部包指向本 fork（本地验证才可信）',
      detail: workspaceLinks.ok
        ? workspaceLinks.detail
        : `${workspaceLinks.detail} —— 此时"在 fork 里验证 dsh-shared 改动"读到的是主工作区的旧包（假验证）；用 fork-pool create 重建即可`,
    })
  }
  if (baselineIntegrity) {
    items.push({
      id: 'baseline-integrity',
      ok: baselineIntegrity.ok,
      fatal: true,
      label: 'fork 未被改写（创建时的基线提交仍在历史中）',
      detail: baselineIntegrity.detail,
    })
  }
  if (baseline) {
    // 「远端 main 已前进」是**长寿命 fork 的正常生命周期**（尤其 PR 合并后），不是异常。
    // 把它判成 ✖ 会让每个 fork 长期假红 —— 当 ✖ 成为常态，真异常也会被无视
    // （这正是 CI 上刚吃过的教训的镜像）。所以这里一律 info：不参与 ok 判定、不阻塞推送。
    items.push({
      id: 'baseline',
      info: true,
      ok: true,
      fatal: false,
      label: '远端基线状态（提示，不阻塞）',
      detail: baseline.stale
        ? `远端 <base> 已前进（${baseline.reason}）—— 合并前需要 rebase，不影响本地推送`
        : baseline.reason,
    })
  }
  items.push({
    id: 'exclude',
    ok: stagedNodeModules.length === 0,
    fatal: true,
    label: 'node_modules 未被误暂存',
    detail:
      stagedNodeModules.length === 0
        ? '干净'
        : `发现 ${stagedNodeModules.length} 个 node_modules 相关暂存项（git add -A 会误提交软链）：${stagedNodeModules.slice(0, 3).join('、')}`,
  })
  return items
}

/** 渲染自检结论：首行给结论，随后逐项证据。 */
export function renderCheckReport({ forkDir, branch, items = [], verify = null } = {}) {
  const fatalFailed = items.filter((i) => i.fatal && !i.ok)
  const staticOk = fatalFailed.length === 0
  const verifyOk = verify === null ? null : verify.code === 0
  const ok = staticOk && (verifyOk === null || verifyOk)
  const lines = []
  lines.push(`fork 自检：${ok ? '✅ 可以推送' : '❌ 不可推送（先修下面的 ✖）'}`)
  lines.push(`  目录：${forkDir}`)
  if (branch) lines.push(`  分支：${branch}`)
  for (const item of items) {
    const mark = item.info ? '·' : item.ok ? '✔' : item.fatal ? '✖' : '⚠'
    lines.push(`  ${mark} ${item.label}：${item.detail}`)
  }
  if (verify === null) {
    lines.push('  · 本地校验：未执行（--static 只做静态自检；完整自检会跑 verify-local --fast）')
  } else {
    lines.push(
      `  ${verify.code === 0 ? '✔' : '✖'} 本地校验 verify-local --fast：exit ${verify.code}，${verify.summary ?? '见上方输出'}`,
    )
  }
  return { text: lines.join('\n'), ok }
}

/**
 * 参数解析。刻意把"写外部状态"的开关（--yes / --push）与只读命令分开：
 * 非交互环境下**没有显式开关一律拒绝**（AGENTS.md「写操作默认拒绝」）。
 */
export function parseForkPoolArgs(argv = []) {
  const args = [...argv]
  const command = args.shift() ?? 'help'
  const options = {
    command,
    id: null,
    dir: null,
    branch: null,
    base: 'main',
    baseRef: 'origin/main',
    hooks: true,
    nodeModules: 'symlink',
    json: false,
    yes: false,
    staticOnly: false,
    errors: [],
  }
  const positional = []
  const value = () => {
    const next = args.shift()
    if (next === undefined) options.errors.push(`${command}：缺少参数值`)
    return next
  }
  while (args.length > 0) {
    const flag = args.shift()
    switch (flag) {
      case '--dir':
        options.dir = value()
        break
      case '--branch':
        options.branch = value()
        break
      case '--base':
        options.base = value() ?? 'main'
        options.baseRef = `origin/${options.base}`
        break
      case '--node-modules':
        options.nodeModules = value()
        break
      case '--no-hooks':
        options.hooks = false
        break
      case '--yes':
      case '-y':
        options.yes = true
        break
      case '--json':
        options.json = true
        break
      case '--static':
        options.staticOnly = true
        break
      case '-h':
      case '--help':
        options.command = 'help'
        break
      default:
        if (String(flag).startsWith('--')) options.errors.push(`未知参数：${flag}`)
        else positional.push(flag)
    }
  }
  const [first, ...rest] = positional
  if (command === 'create') {
    options.id = first ?? null
    if (first === undefined) options.errors.push('create：缺少 fork 编号（如 create 240）')
    if (rest.length > 0) options.errors.push(`create：多余参数 ${rest.join(' ')}`)
  } else if (command === 'check' || command === 'clean') {
    options.id = first ?? null
    // check 允许省略目标：默认校验"当前目录"——在 fork 里跑 `fork-pool check` 是最顺手的用法；
    // clean 是删除动作，必须显式给目标（不给就报错，绝不默认删当前目录）。
    if (first === undefined && command === 'clean') options.errors.push('clean：缺少 fork 编号或路径')
  } else if (command !== 'list' && command !== 'help') {
    options.errors.push(`未知命令：${command}`)
  }
  if (!NODE_MODULES_MODES.includes(options.nodeModules)) {
    options.errors.push(`--node-modules 只支持 ${NODE_MODULES_MODES.join(' / ')}`)
  }
  return options
}

/**
 * check/clean 的目标解析：编号 → <tmpRoot>/gh-fork-<编号>；路径（绝对 / ./ / ../ / 省略）→ 原样归一化。
 * 为什么要区分：`check .` 与 `check 240` 都是自然用法，前者必须落到当前目录而不是
 * 去拼一个叫 "." 的 fork 名（那会直接抛"非法编号"，把顺手用法变成报错）。
 */
export function resolveTargetDir(target, tmpRoot = '/tmp', explicitDir = null, cwd = process.cwd()) {
  if (explicitDir) return normalizePath(explicitDir)
  const text = String(target ?? '').trim()
  if (text.startsWith('/')) return normalizePath(text)
  const isRelativePath = text === '' || text === '.' || text === '..' || text.startsWith('./') || text.startsWith('../')
  if (!isRelativePath) return forkDirFor(text, tmpRoot)
  const base = text === '' ? '.' : text
  return normalizePath(`${cwd}/${base}`)
}

/**
 * workspace 内部包（plugins/* 里被根 package.json 用 `file:` 引用的那些，如 dsh-shared）。
 *
 * 为什么必须单独处理：主工作区的 `node_modules/<name>` 是 npm 为 `file:plugins/<dir>` 建的
 * **相对软链**（`../plugins/<dir>`）。fork 的 node_modules 是逐包软链到主工作区的，
 * 于是 fork 里的 `node_modules/dsh-shared` → 主工作区 `node_modules/dsh-shared` →
 * realpath 落在**主工作区**的 `plugins/dsh-shared`。
 *
 * 后果比"没验证"更糟 —— **验证了错的代码**：在 fork 里改了 dsh-shared 的导出，从 fork
 * 加载依赖它的插件时读到的仍是主工作区的旧包（实测：fork 内改成 9.9.9-forkprobe，
 * 依赖方仍解析到 0.1.4），报错形如
 * `dsh-shared does not provide an export named createWriteScheduler`。
 *
 * 修法：把这些包在 **fork 的** node_modules 下指向 **fork 内**的 plugins/<dir>。
 */
export function planWorkspaceLinks(entries = []) {
  return entries
    .filter((e) => e && typeof e.name === 'string' && typeof e.dir === 'string' && e.name && e.dir)
    .map((e) => ({ name: e.name, dir: e.dir, expectedSuffix: `/plugins/${e.dir}` }))
}

/**
 * 判定这些包当前指向哪里。`links` 形如 `[{ name, dir, resolved }]`
 * （resolved = realpath 解析结果，取不到传 null）。
 * 只要有一个落在 fork 之外就算不通过 —— 这正是"假验证"的直接信号。
 */
export function evaluateWorkspaceLinks(links = [], { forkDir } = {}) {
  const root = String(forkDir ?? '').replace(/\/+$/, '')
  const wrong = []
  const missing = []
  for (const link of links) {
    if (!link.resolved) {
      missing.push(link.name)
      continue
    }
    const expected = `${root}/plugins/${link.dir}`
    if (!String(link.resolved).startsWith(`${expected}`) && String(link.resolved) !== expected) {
      wrong.push({ name: link.name, resolved: link.resolved, expected })
    }
  }
  const ok = wrong.length === 0 && missing.length === 0
  const detail = ok
    ? `${links.length} 个内部包全部指向本 fork`
    : [
        wrong.length > 0
          ? `指向主工作区/别处的 ${wrong.length} 个：${wrong
              .slice(0, 3)
              .map((w) => `${w.name} → ${w.resolved}`)
              .join('、')}`
          : '',
        missing.length > 0 ? `解析失败的 ${missing.length} 个：${missing.slice(0, 3).join('、')}` : '',
      ]
        .filter(Boolean)
        .join('；')
  return { ok, wrong, missing, detail }
}

/** 人可读的耗时（毫秒 → 123ms / 1.2s）。 */
export function formatMs(ms) {
  const value = Number(ms) || 0
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`
}
