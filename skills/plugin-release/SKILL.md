---
name: plugin-release
description: 使用当 需要把已开发、已测试的 DSH 插件安全地发布出去时——确认目标版本与发布轨、打包与产物校验、版本依赖基线、逐层发布门禁、发布语义门禁、npm publish 与 Git tag、失败回滚，以及 profile 依赖管理。发布是单向外发动作：任何实际发布或推 tag 前必须先展示计划并确认，跳过门禁须带 --skip-reason。
---

# plugin-release

把已开发、已测试的插件安全地发出去。发布是单向外发动作，**任何实际发布或推 tag 前必须先展示计划并确认**；本 Skill 不替你决定版本号，也不自动 bump 版本。

## 第 0 步：确认目标版本与发布轨

| 发布轨 | 适用 | 关键事实 |
|---|---|---|
| GitHub 直装 | `dsh plugin --profile <p> add github:owner/repo` | 消费者解析默认分支 HEAD；发布=推送到 main，**推前必须跑完整门禁** |
| npm registry | `npm publish` | 仅正式发布线可用；`@deepseek-ai/*` 的 alpha/rc 前缀版本**不一定**在 npm 上，发布前先 `npm view <pkg> versions` 核实 |
| hub 收录 | 在 hub catalog 登记 | 登记是独立动作，不代替打包验证 |
| collection | 把成员插件 vendored 成 pack artifact | 见所属 collection 仓库的自有流程 |

未发布 cohort（例如某个 cohort 版本从未发到 npm——alpha.1 只有 GitHub 来源；alpha.2 到 alpha.4 已通过 `alpha` 通道标签发布）走 [references/publish-playbook.md](references/publish-playbook.md) 的 overrides 流程，**不要**在 npm 上找不存在的版本，也不要因此切换包管理器。

## 第 1 步：打包与产物校验

1. 用仓库唯一的包管理器与 lockfile（有 `package-lock.json` 用 npm，有 `pnpm-lock.yaml` 用 pnpm）；
2. 跑完整门禁（见第 3 步），再 `npm pack` / `pnpm pack`；
3. 解包校验：`files` 覆盖全部运行时相对导入与资产；产物里没有 `.ts` 残留；`cordis.patch.yml`/`dsh.plugin.json`/`SKILL.md` 等形态文件齐全；
4. tarball 装入隔离 profile 做消费验证（`dsh --profile compat --dump-config` 出现本插件 row → 工具真实注册与执行）。

## 第 2 步：版本依赖基线（alpha 时代）

- devDependencies 使用 **npm 发布线**（当前 0.1.1-rc.2）作为类型基线，保证公开仓库在任何机器上 `npm install` 后 typecheck 可用；
- peer 范围用宽范围（如 `<0.2.0`）覆盖未发布的 alpha/rc；
- 代码需要兼容本地 harness（GitHub tag）与 npm 发布线两侧时，用**双兼容写法**：保留 npm 发布线类型要求的形态，同时在 alpha 运行时语义不变（见 playbook 的“双兼容写法”节）；
- 不要把本机绝对路径（junction/file:）写进提交的 package.json。

## 第 3 步：发布门禁（逐层，前层不过不进后层）

1. 依赖解析：lockfile 只发生预期变化；无混合 cohort；
2. 静态：typecheck + 插件测试 + build；
3. 真实挂载：在**锁定精确 DSH tag**（禁止用可变的 master/main 冒名验收）的隔离 profile 上冷启动目标宿主，entry active、服务不停 pending。Web Client 插件还要验证：宿主公告资源（启动图/boot 名单中的 bundle 入口）可访问、bundle 注册成功、DOM 挂载完成、无 page error——只看 `--dump-config` 不算完成本层；
4. 行为：一条核心路径真实执行（工具插件=一次消息→工具→回复；或等价专用流程）；
5. 包装器：核对退出码与 stdout/stderr 归属。

### 插件形态与门禁适用性（仓库级，`scripts/release.mjs` 1b-pre，issue #231）

`plugins/` 下的目录不都是 profile 插件。发版门禁按 `package.json` 的**显式形态声明**决定适用性——不写插件名单（名单会腐烂）：

| 形态 | 显式声明 | 门禁差异 |
|---|---|---|
| profile 插件（bundle） | `dsh.bundle.patch`（有 UI 时另有 `dsh.client`） | 全部门禁：`peerDependencies.cordis`、跨插件依赖、真实挂载 |
| 共享工具包 | `dsh.kind=library` | 豁免 `peerDependencies.cordis`（1b）与 profile 组合验证（3c） |
| **agent preset 资产包** | `dsh.kind=preset` + 非空 `dsh.presetReason` | 同上豁免 1b + 3c；跨插件依赖（1c）、CHANGELOG、测试、效果图门禁照旧 |

- preset 资产包 = `agent.cordis.yml`（预设组合，宿主 `@deepseek-ai/dsh-agent-presets` 的 `COMPOSITION_FILE`，**目录名即 preset id**）+ `preset.yml`（模式选择器的 name/description 显示元数据，`METADATA_FILE`），由安装脚本复制到 `$DSH_HOME/.agent-presets/<id>/`；它**不挂 profile**、没有 `cordis.patch.yml`，所以**不该**补 `peerDependencies.cordis`（那会让 npm 消费者以为它是 cordis 插件包）；
- 判据与仓库不变量（`scripts/lib/preset-gate.mjs`，单测 `scripts/test/preset-gate.test.mjs`）：`dsh.kind=preset` 必须真的有 `agent.cordis.yml` + `preset.yml` 且内容成形（组合含插件行、元数据含非空 `name`）；与 `dsh.bundle` / `dsh.client` 互斥；目录里有 preset 资产却不声明也会被拦下，并提示正确修复方式（而不是误报缺 cordis peer）；
- **豁免不削弱拦截**：preset 只豁免 1b 的 cordis peer 与 3c 的 profile 组合验证；注入未声明的真实 `dsh-*` `import` 仍会被 1c 拦下；
- 豁免结果在发版输出与批量汇总显式列出（含 `dsh.presetReason`），不悄悄放行。

### README 效果图门禁（仓库级，`scripts/release.mjs` 3b）

- 插件 README 必须引用 `assets/` 下真实存在的截图（`./assets/<file>` 或 unpkg 绝对 URL）；
- **无用户可见 UI 的插件走显式声明豁免**：`dsh.kind=library`（共享工具包，沿用原豁免）或 `dsh.ui=false` + 非空 `dsh.uiReason`；声明缺失/自相矛盾（如同时声明 `dsh.client`）会被门禁拒绝——不存在「想要就豁免」的插件名单；
- 发版输出与批量汇总显式列出「已豁免」插件与理由（豁免可见、可审计）；
- `--all-checks`（仅 dry-run）：静态门禁全部跑完再统一报告失败项，避免 fail-fast 让后续门禁从未执行而掩盖缺陷（`--push` 仍为首个失败即停的完整门禁）。

## 第 4 步：发布语义门禁（任一不满足即停止发布）

1. GitHub Release tag 必须等于 `v${package.json.version}`；
2. 版本号是否含 prerelease 后缀（`-` 之后、`+` build metadata 之前的段），必须与 GitHub Release 的 prerelease 状态一致；
3. prerelease 只能发布到**项目声明的非 latest dist-tag**（名称由项目自定，如 `next`、`alpha`——不写死具体名字）；无后缀的 stable 版本才进入 `latest`；
4. stable 发布前查询现有 `latest`（`npm view <pkg> dist-tags.latest`），semver 低于现有 latest 时拒绝发布，防止把 latest 回退到更低版本。

## 第 5 步：发布与回滚

- 发布前：干净提交 + 打 tag；记录 lockfile 与 composition 基线 hash；
- 发布后：以消费者身份重装一次并冒烟；
- 回滚：优先回退发布（删 tag/重新指向旧 commit），不发布“兼容两边”的补丁掩盖问题；
- 未发布 cohort 的 CI 见 playbook 的“CI 与发布门禁”节（缓存 cohort store、`NPM_PUBLISH_ENABLED` 开关）。

## 批量发版（一次多个插件）

所有插件共享同一个 bump 类型，两个入口：

| 入口 | 怎么发 | 能力边界 |
|---|---|---|
| GitHub Actions | Actions → **Release (auto)** → Run workflow：`plugins` 填多个目录名（**逗号或空格**分隔，如 `dsh-md-render,dsh-my-guard`），`bump` 下拉单选 | `plugins` 是文本框不是下拉——GitHub Actions 的 `choice` 原生不支持 `multiple`（issue #204）；workflow 内先跑白名单校验（允许值运行时取自 `plugins/` 目录），非法名 fail-fast 并列出全部允许值 |
| 本地 | `node scripts/release.mjs a b c --bump patch --push` | 与 CI 同一脚本、同一门禁 |

批量不降低门禁：每个插件仍独立走第 1-4 步（一个失败不影响其他），全部通过才一次提交 + 逐个打 tag。细节见 `docs/开发指南/发版流程.md` 的「批量发版」节。

## 安全边界

- 发布/推 tag/写 hub 登记前必须展示计划并确认；不自动 bump 版本；
- 不发布含凭据、`.npmrc` 内容、会话日志或私有路径的产物；
- 不切换包管理器、不重写另一套 lockfile；失败时只回滚本次拥有的路径并报告残留。

## 参考材料

| 文件 | 内容 |
|---|---|
| [references/publish-playbook.md](references/publish-playbook.md) | 未发布 cohort 安装、双兼容写法、CI/发布门禁、真实坑位清单与回滚配方 |
| [references/profile-dependency-management.md](references/profile-dependency-management.md) | profile 安装/更新配方：github 依赖锁缓存、包改名三处同步、junction 清理与宿主升级联动 |
