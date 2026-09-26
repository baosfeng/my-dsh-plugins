/**
 * 门禁登记表（issue #330）—— 「检查项 → 唯一权威执行点 → 理由 / 耗时」的**机器可读**单一事实源。
 *
 * 为什么需要它：优化前仓库里有 17 条门禁规则，散落在 5 个 CI job + husky 钩子 + verify-local
 * 三处，同一件事被重复执行（同一批 server TS 被 tsc 检查 3 遍、prettier 跑 3 遍），且**没有任何
 * 机制**能回答「本地跑的和 CI 跑的是不是同一套」。人肉维护的清单必然漂移。
 *
 * 本表由 `scripts/check-gate-parity.mjs` 与两份**真实来源**交叉校验（任何一处漂移即红）：
 *   ① `.github/workflows/ci.yml` 文本（CI 到底跑了什么 —— 解析真实 YAML，见 lib/ci-workflow.mjs）
 *   ② `node scripts/verify-local.mjs --list --json`（本地到底跑了什么 —— 取运行时的真实清单）
 * 校验是**双向**的：声明了但没跑 → 报错；跑了但没声明 → 报错。缺口逐条列出，不静默通过。
 *
 * 字段：
 *   id           与 `scripts/verify-local.mjs` 的 CHECK_DEFS id 一一对应
 *   authority    这条规则的**唯一权威执行点**（哪份配置/脚本的判定说了算）
 *   local        'always' | 'fast-scoped' | 'optional' | null（null = 本地无此检查项）
 *   localCommand verify-local 实际执行的命令（与 CHECK_DEFS.command 机械比对，防止「写一套跑另一套」）
 *   ci           CI 主执行点 { job, step, command }；quality 的十三个 gate 共用聚合步骤
 *   ciAlso       同一规则的其它 CI 步骤（如 test job 的语法检查）
 *   cost         本机实测耗时（M 系列 Mac，热 node_modules）
 *   why          为什么它是权威 / 为什么不能删（含它拦住过的真实案例）
 *
 * ⚠️ 改本表必须同时改 `scripts/verify-local.mjs` / `ci.yml`，否则 `gate-parity` 门禁变红——
 *    这正是本表存在的意义：让「少跑了一条规则」不可能悄悄发生。
 */

/** quality job 的聚合执行步骤（CI 里唯一的门禁步骤，内部并发跑 ci.job==='quality' 的全部 gate）。 */
export const CI_QUALITY_STEP = {
  job: 'quality',
  step: 'Quality gates (concurrent, registry-driven)',
  command: 'node scripts/verify-local.mjs --ci-quality',
}

/** CI 中**不属于**任何门禁规则的步骤（基础设施），parity 反向校验的白名单。 */
export const CI_INFRA_STEPS = [
  /^actions\/checkout@/,
  /^actions\/setup-node@/,
  /^coverallsapp\/github-action@/,
  /^npm ci$/,
]

/**
 * CI 基础设施里**必须 `continue-on-error: true`**（尽力而为、不得判红）的第三方上报步骤（issue #350）。
 *
 * 为什么单列：`coverallsapp/github-action` 是**第三方上报**动作，运行时要下载二进制并校验 checksum。
 * 实测（#349 首次 run `34993038142`）：test (dsh-my-notify) job 内插件测试全绿
 * （Test Files 17 passed / 17 scenarios passed），却仅因
 * `Failed to download coveralls binary or checksum (Linux).` 把整个 job 判红 → 一次无谓的 CI 往返
 * （排队 + 19 插件 matrix + 读日志定位 + 重跑），且**与本次改动无关**。它命中规范第十四节的
 * 第三种漏网形态「本地无、CI 有」，而且是其中最难防的一种：本地既无法预知、也无法拦住。
 *
 * ⚠️ 边界（绝不能混）：覆盖率**阈值门禁**由各插件自身的 vitest coverage 强制
 * （行 ≥85 / 分支 ≥75 / 函数 ≥80，见根 `vitest.config.mjs`），那部分**仍然阻断**；本类步骤只把
 * 已算出的结果**上报**到第三方看板 → 定位是「尽力而为」，不该决定 PR 红绿。失败仍留在 run 日志与
 * job annotation 里（可观测性不丢）。反向由 `check-gate-parity.mjs` 守住：去掉 `continue-on-error` 即红。
 */
export const CI_BEST_EFFORT_STEPS = [/^coverallsapp\/github-action@/]

export const GATE_REGISTRY = [
  {
    id: 'test',
    authority: '各插件自己的 `npm test`（vitest + 覆盖率门禁 + Gherkin）',
    local: 'always',
    localCommand: 'npm test（逐插件）',
    ci: { job: 'test', step: 'Test ${{ matrix.plugin }}', command: 'npm test' },
    ciAlso: [{ job: 'test', step: 'Syntax check', command: 'node --check' }],
    cost: 'CI 每插件一个 matrix job；本地全量 23s（19 插件、6 路并发），fast 单插件 9.6~11.4s',
    why: '唯一权威：插件行为只能由插件自己的测试判定。本地遍历 19 个目录（含 dsh-shared），CI matrix 19 个插件并行；本地多测一个库，更严不更松。',
  },
  {
    id: 'typecheck',
    authority: '根 `tsconfig.json`（`npx tsc --noEmit`）',
    local: 'always',
    localCommand: 'npx --no-install tsc --noEmit',
    ci: { ...CI_QUALITY_STEP },
    cost: '0.5~1.5s',
    why: '保留：它独有地覆盖 `plugins/*/lib/*.d.ts`（tsc 产物声明）与根级 TS —— 这部分**不在**任何插件 tsconfig 的 include 内（插件只 include `src/**`）。范围已按此收窄，与插件 tsc 不再重叠，见 tsconfig.json 注释。',
  },
  {
    id: 'typecheck-plugins',
    authority: '各插件的 `tsconfig.json`（server 构建语义）+ `tsconfig.client.json`（client 拼接语义）',
    local: 'always',
    localCommand: 'node scripts/typecheck-all.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '改前 12.6s（29 次串行 npx tsc）→ 改后 0.9~2.0s（直调 bin + 4 路并发）',
    why: '唯一权威：这是**真实构建用的那份配置**，产物由它生成。client parts 是拼接片段（无 import/export），只能在该语义下检查（根 nodenext 会对每个片段报 TS2304/TS2552）。issue #330 第 5 条：改前它**只在 CI 跑**，本地 verify-local 只跑根 tsc → client 端本地零检查、本地绿 CI 红，白等一轮 CI。',
  },
  {
    id: 'lint',
    authority: '`eslint.config.js`（complexity ≤10 / 函数 ≤70 行 / 文件 ≤400 行 / import 解析）',
    local: 'fast-scoped',
    localCommand: 'npx --no-install eslint plugins/',
    ci: { ...CI_QUALITY_STEP },
    cost: '全量 8~14s（随机器负载）；fast 按变更裁剪后 0.8s',
    why: '唯一权威：规则集只有这一份（flat config）。pre-commit 的 lint-staged 只对**暂存** .js/.mjs 跑 `--fix`，是「改完即修」的便利通道，不是门禁执行点——它绿不代表 CI 全量绿，这正是本地按变更裁剪 + CI 全量兜底的分工。',
  },
  {
    id: 'ts-size',
    authority: '`scripts/check-ts-size.mjs` + `scripts/ts-size-baseline.json`',
    local: 'fast-scoped',
    localCommand: 'node scripts/check-ts-size.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '0.4~1.4s',
    why: '唯一权威：eslint flat config 没有 `.ts` 块（typescript-eslint 尚不兼容 TS 7），TS 源码的尺寸/复杂度门禁只能由它用 @babel/parser 施加（冻结债务基线只允许变好）。',
  },
  {
    id: 'client-modules',
    authority: '`scripts/check-client-modules.mjs`',
    local: 'fast-scoped',
    localCommand: 'node scripts/check-client-modules.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '0.3s',
    why: '唯一权威（issue #321）：客户端产物 require 的模块必须能解析，否则浏览器端 ModuleLoader 抛 `missed the module table` 让整条 client factory 挂掉（#39/#290/#293 三次事故同根因）。',
  },
  {
    id: 'client-size',
    authority: '`scripts/check-client-size.mjs` + `scripts/client-size-baseline.json`（issue #322）',
    local: 'fast-scoped',
    localCommand: 'node scripts/check-client-size.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '~0.3s（纯统计，无外部输入）',
    why: '唯一权威（issue #322）：只量「发布面」体积（插件 package.json 的 files 字段决定的 lib/**、assets/**）不得超过「基线 + 余量」——#185 曾把 4.48 MB 冗余注入 client bundle，全靠人工发现。',
  },
  {
    id: 'pack-hygiene',
    authority: '`scripts/check-pack-hygiene.mjs`（issue #323）',
    local: 'fast-scoped',
    localCommand: 'node scripts/check-pack-hygiene.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '~1.3s（含 19 次 npm pack，内部并发 6）',
    why: '唯一权威（issue #323）：exports/main/types/dsh.bundle.patch 指向真实文件、dsh.client 与 exports["./client"] 互证、`npm pack` 内容「该有的在 / 不该发的没在」、README 引用的 assets 确实随包发布。',
  },
  {
    id: 'format',
    authority: '`.prettierrc.json` + `.prettierignore`（`prettier --check`）',
    local: 'fast-scoped',
    localCommand: 'npx --no-install prettier --check --ignore-unknown',
    ci: { ...CI_QUALITY_STEP },
    cost: '全仓 9~16s（随机器负载）；fast 按变更裁剪后 0.8s',
    why: '唯一权威：CI 全仓 `prettier --check .`。pre-commit 只对暂存文件 `--write`（便利通道）。改前对「只改 1 个文件」的推送，本地也要全仓扫 7.1s，属纯浪费。',
  },
  {
    id: 'test-scripts',
    authority: '`vitest run --coverage --config scripts/test/vitest.config.mjs`',
    local: 'always',
    localCommand: 'npm run test:scripts',
    ci: { ...CI_QUALITY_STEP },
    cost: '7.4~13.6s',
    why: '唯一权威：发版/校验脚本（release、fork-pool、impact-scope…）的纯函数单测，含覆盖率门禁，无其它执行点。',
  },
  {
    id: 'depcruise',
    authority: '`.dependency-cruiser.js`',
    local: 'always',
    localCommand: 'npx --no-install depcruise plugins/',
    ci: { ...CI_QUALITY_STEP },
    cost: '2.3~8.1s',
    why: '唯一权威：依赖结构（无循环依赖、server/client 不交叉）只有这一处判定。本地必须排在插件测试**之后**（测试会建/删 coverage 目录，扫到半截 ENOENT）。',
  },
  {
    id: 'knip',
    authority: '`knip.json`',
    local: 'always',
    localCommand: 'npx --no-install knip',
    ci: { ...CI_QUALITY_STEP },
    cost: '1.1~2.3s',
    why: '唯一权威（issue #45）：未使用的文件/依赖/导出。**注意**：它解析 `.husky/pre-commit` 脚本文本来提取 known bins，该文件里的 `npx --no-install lint-staged` 必须是文本可见的真实命令，改成变量会让 knip 报 `Unused devDependencies: lint-staged` 而红（见 docs/踩坑/README.md 第三节）。',
  },
  {
    id: 'jscpd',
    authority: '`.jscpd.json`（min-tokens 100 / 阈值 5%）',
    local: 'always',
    localCommand: 'npx --no-install jscpd',
    ci: { ...CI_QUALITY_STEP },
    cost: '0.3s',
    why: '唯一权威（issue #45）：复制粘贴检测，逼重复代码抽到 dsh-shared。',
  },
  {
    id: 'docs',
    authority: '`scripts/check-docs.mjs`',
    local: 'always',
    localCommand: 'node scripts/check-docs.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '0.1s',
    why: '唯一权威：插件 ↔ README / AGENTS.md / docs 索引 / 安装章节的一致性（防「插件部署了文档没更新」）。',
  },
  {
    id: 'doc-api',
    authority: '`scripts/check-doc-api-drift.mjs`',
    local: 'always',
    localCommand: 'node scripts/check-doc-api-drift.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '0.12~0.14s',
    why: '唯一权威：`docs/官方文档/本仓库重点.md` 的 API 面是**从 `plugins/*/src` 取证**的派生内容（实际调用哪些宿主能力 / 事件 / UI 槽位 / 哪些 API 代码零使用），靠人工维护必然漂移。典型漂移两类：① 文档与 skill 主推代码里零使用的 API（如第三方 `ctx.betterSidebar`）；② 文档写**根本不存在**的 API（如 `ctx.config`，全仓只在注释里出现，配置入口是 `apply(ctx, config)` 第二实参）。因此本门禁**双向**判定：文档提到代码里不存在的 API → 红；代码在用而文档未登记 → 红。扫描 `plugins/*/src` 时**先剥注释**再匹配，否则注释里的 `ctx.config` 会被当成"代码在用"，第一条事故就再也抓不到。范例坐标 `path:line` 另做校验（文件存在 / 行号在范围内 / 该文件确实含所声明的 API；行号允许漂移，避免每次改代码都红）。零外部依赖（不读 `~/.dsh-refs`、不需官方仓库检出），CI 可直接跑。',
  },
  {
    id: 'links',
    authority: '`scripts/check-links.mjs`',
    local: 'always',
    localCommand: 'node scripts/check-links.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '0.4s',
    why: '唯一权威：文档引用完整性（markdown 链接/锚点、反引号路径 token、shell 调用、npm script、skill 与插件名）。本卡新增的脚本因此必须登记进 package.json 并在文档里被正确引用，否则它红。',
  },
  {
    id: 'action-pins',
    authority: '`scripts/check-action-pins.mjs` + `scripts/lib/action-pins.mjs`（issue #435）',
    local: 'always',
    localCommand: 'node scripts/check-action-pins.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '~0.05s（纯本地文件扫描，无外部输入）',
    why: '唯一权威（issue #435）：workflow 里同一 GitHub Action 的**多子路径必须同 ref**——Dependabot 的依赖粒度是子路径，会把 `github/codeql-action/analyze` 当独立依赖单侧 bump（#430），而 CodeQL 要求 init/analyze 同版本，分叉即恒红 `Loaded a configuration file for version 4.38.0, but running version 4.38.1`，且**所有 PR 被假红挡住**（#433 被挡；main 那次绿只是 run 早于 #430 的假象）。人工 review 拦不住「两个 SHA 看着都写了 # v4」这种形态，故必须机器判定。',
  },
  {
    id: 'gate-parity',
    authority: '`scripts/check-gate-parity.mjs` + `scripts/lib/gate-registry.mjs`',
    local: 'always',
    localCommand: 'node scripts/check-gate-parity.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '0.1s',
    why: '唯一权威（issue #330 新增）：本表 ↔ `ci.yml` ↔ `verify-local` 三方交叉校验，双向检测「声明了没跑」与「跑了没声明」。它自己也在 CI 跑——否则「校验覆盖一致性」这件事本身就成了新的静默缺口。',
  },
  {
    id: 'review-scripts',
    authority: '`.github/scripts/review-verdict.cjs`（PR 审查判定内核）+ 其 `node --test` 单测',
    local: 'always',
    localCommand: 'node --test .github/scripts/*.test.cjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '~0.3s',
    why: '唯一权威（issue #311）：审查结论的三态判定（通过 / 不通过 / **未能判定**）、「没能真正跑」不写成通过、同一 commit 结论一致与「疑似抖动只标注不翻转」、历史摘要渲染，全部由该内核的纯函数决定。它的失败模式是「悄悄把没跑成写成通过」（正是 #311 要根治的病），所以必须有单测且单测必须真的跑在门禁里——#303 的同类用例此前只在人工执行时跑过。',
  },
  {
    id: 'test-sleeps',
    authority:
      '`scripts/check-test-sleeps.mjs` + `scripts/lib/test-sleeps.mjs` + `scripts/test-sleep-baseline.json`（issue #335）',
    local: 'fast-scoped',
    localCommand: 'node scripts/check-test-sleeps.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '~0.2s',
    why: '唯一权威（issue #335）：`plugins/*/test/**` 里**新增**的固定时长等待（setTimeout(N>0)/settle(N)/sleep(N)）必须写 `// sleep-ok: <为什么不能用条件轮询>`，存量冻结在基线里只许变少。同族根因反复复发：CI 高负载下固定 sleep 赌异步必输。',
  },
  {
    id: 'artifacts',
    authority: '`scripts/check-client-artifacts.mjs` + `scripts/lib/client-artifacts.mjs`（ADR-0002）',
    local: 'always',
    localCommand: 'node scripts/check-client-artifacts.mjs',
    ci: { ...CI_QUALITY_STEP },
    cost: '10~12s（**独占**执行：它走各插件 build.mjs 重建产物，会写工作区，见 verify-local 的 exclusive 注释）',
    why: '唯一权威（issue #318 / ADR-0002）：共享部件 `plugins/dsh-shared/client-parts/*` 是纯函数文本片段，构建期 splice 进消费方的 `lib/client.js`；server 端 `lib/*.js` 是 tsc 产物。两者都必须提交，而 CI 不跑构建 → 漏重建会静默陈旧（实测 commit 735e2fa 加图标只重建了 2 个消费方）。重建后与已提交产物逐字节比对，fail-closed。',
  },
  {
    id: 'merge-ref',
    authority: '`git merge-base --is-ancestor origin/main HEAD`（verify-local 内置检查）',
    local: 'always',
    localCommand: 'git merge-base --is-ancestor origin/main HEAD',
    ci: null, // CI 自身就是 merge ref（GitHub 在 PR 上 checkout 合并结果），故这是**本地专属**检查
    cost: '0.05s',
    why: '工程效率规范第十四节：CI 在 pull_request 上测的是「你的分支 + 最新 main」的合并结果，本地测的是你自己的分支——差异会让「本地过 ⇒ CI 过」天然不成立（#322 的 agent 因此误判过「CI 与本地差 2.3KB」）。本检查把它显式化：分支未包含 origin/main 即失败并给出 rebase 修法。',
  },
  {
    id: 'resource-smoke',
    authority: '`scripts/resource-smoke.mjs`',
    local: 'fast-scoped',
    localCommand: 'node scripts/resource-smoke.mjs',
    ci: { job: 'resource-smoke', step: 'Resource smoke', command: 'node scripts/resource-smoke.mjs' },
    cost: '10.8s',
    why: '唯一权威（issue #127）：长会话写放大 ≤1.6 / 内存有界 / 降级与恢复。独立 job 与 test 并行，不拉长主流程。',
  },
  {
    id: 'secret-scan',
    authority:
      '`scripts/check-secrets.mjs` + `.gitleaks.toml`（二进制钉在 `scripts/ci-tools.json`：版本 + 发布产物 SHA256）',
    local: 'always',
    localCommand: 'node scripts/check-secrets.mjs',
    ci: {
      job: 'history-gates',
      step: 'Secret scan (gitleaks, pinned version + SHA256, full history)',
      command: 'node scripts/check-secrets.mjs',
    },
    cost: '扫 692 提交 5.8~12.1s（首次另需下载二进制 7.9MB；CI 实测 12.8s）',
    why:
      '唯一权威（issue #324）：CI 层能在合并前拦下凭据，而 GitHub 原生 secret scanning 是**事后**告警' +
      '（本仓库还有 Dependabot 告警被 auto_dismissed 的假阴性教训，见 docs/踩坑/npm-audit在镜像源下静默失效.md）。' +
      '与 CI 同一个二进制、同一份配置；命中即失败且**不回显明文**（只给 文件:行:规则）。' +
      '扫描范围是全历史 → 需要 fetch-depth: 0，故由独立的 history-gates job 执行（quality 是浅克隆）。',
  },
  {
    id: 'commits',
    authority: '`.commitlintrc.json`（config-conventional + type-enum）——与本地 `.husky/commit-msg` 同一份规则',
    local: 'always',
    localCommand: 'node scripts/check-commit-messages.mjs',
    ci: {
      job: 'history-gates',
      step: 'Commit messages (changed range only)',
      command: 'node scripts/check-commit-messages.mjs',
    },
    cost: '1~5 条提交 0.3~0.5s',
    why:
      '唯一权威（issue #324）：**只校验本次变更范围**的提交信息。不查全历史是刻意的——历史欠账' +
      '（body-max-line-length / header-max-length / subject-case / type-enum 等存量不合格提交）比例不低，' +
      '全历史校验会**恒红**，等于把门禁做成摆设。范围推导与 CI 同源（读 GITHUB_EVENT_PATH：PR 的 base..head、push 的 before..after），' +
      '本地自动退化为 @{upstream} → origin/main，也可用 --from/--to 显式指定来复现任意 CI 范围；' +
      '范围不可解析时显式报「**不是**提交信息不合规」（浅克隆实测踩过：CI 首个运行因此红，见 PR 记录）。',
  },
  {
    id: 'audit',
    authority: '`scripts/lib/npm-audit.mjs`（官方 registry + 禁止重写 + moderate 门槛）',
    local: 'optional',
    localCommand: 'npm audit --audit-level=moderate',
    ci: { job: 'audit', step: 'Audit dependencies', command: 'npm audit --audit-level=moderate' },
    cost: 'CI ≈5s（刻意不做 npm ci）',
    why: '唯一权威（issue #199）：本地 registry 常是镜像（无 advisories 端点），故本地默认跳过、CI 强制。刻意**不**做 `npm ci`——audit 只读 lockfile（省 13.4s）。',
  },
  {
    id: 'mutation',
    authority: '`plugins/dsh-file-activity` 的 stryker 配置（break 70）',
    local: 'fast-scoped',
    localCommand: 'npx --no-install stryker run',
    ci: { job: 'mutation', step: 'Mutation testing', command: 'npx stryker run' },
    cost: '本地 ≈12s（**独占**：stryker 自身多 worker，与并发池叠加会资源超卖 → flaky）',
    why: '唯一权威（issue #13）：变异分 ≥70 才算测试真的有效。issue #330 起本地**默认执行**（CI 该 job 是阻断性的；「本地慢」不构成白名单理由），仅 `--fast` 显式跳过。',
  },
]

/** id → gate；重复 id 在加载时即报错（防止静默覆盖）。 */
export const GATE_BY_ID = new Map()
for (const gate of GATE_REGISTRY) {
  if (GATE_BY_ID.has(gate.id)) throw new Error(`gate-registry: 重复的 gate id "${gate.id}"`)
  GATE_BY_ID.set(gate.id, gate)
}

/** verify-local 里应当存在的检查项 id（local !== null 的 gate）。 */
export const LOCAL_CHECK_IDS = GATE_REGISTRY.filter((g) => g.local !== null).map((g) => g.id)

/** `--ci-quality` 应当执行的检查项 id（聚合进 quality job 的 gate）。 */
export const CI_QUALITY_CHECK_IDS = GATE_REGISTRY.filter((g) => g.ci?.job === 'quality').map((g) => g.id)

/**
 * 本地默认跳过的检查项（CI 强制）。
 *
 * ⚠️ 白名单**只能**放「本地环境物理上做不到」的检查（CI 专属凭据 / 官方源网络 / 矩阵 OS·Node 版本 /
 * 上报类动作）。**「本地慢」不是理由**——用户诉求是「本地过 ⇒ CI 过」，一次 CI 往返约半小时，
 * 本地多花几分钟是划算的（工程效率规范第十四节）。
 * 由 `scripts/check-gate-parity.mjs` 逐条校验：白名单项必须有非空 `reason`、必须在 CI 侧真有执行点、
 * 且**不得**出现「标了 optional 却没进白名单」的漏网项（反向防滥用）。
 */
export const LOCAL_EXEMPTIONS = [
  {
    id: 'audit',
    kind: 'ci-env',
    reason:
      'npm audit 依赖官方 registry 的 security advisories 端点（POST /-/npm/v1/security/advisories/bulk），' +
      '而本地 registry 常被配置为 npmmirror 镜像且该端点未实现（404 NOT_IMPLEMENTED）；CI runner 网络可直达官方源。' +
      '属「CI 专属环境」这一正当豁免类别，且本地可用 --audit（或 HTTPS_PROXY）显式开启来复现。',
  },
]

/** 本地默认跳过的检查项（CI 强制）。 */
export const OPTIONAL_CHECK_IDS = GATE_REGISTRY.filter((g) => g.local === 'optional').map((g) => g.id)

/** 所有 CI 执行点声明（含 ciAlso），供 parity 双向校验。 */
export function ciDeclarations() {
  const out = []
  for (const gate of GATE_REGISTRY) {
    for (const decl of [gate.ci, ...(gate.ciAlso ?? [])]) {
      if (decl) out.push({ gate: gate.id, ...decl })
    }
  }
  return out
}
