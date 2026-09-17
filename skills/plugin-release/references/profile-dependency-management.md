# profile 依赖管理（本仓库 recipe）

> 承接 [../SKILL.md](../SKILL.md) 的发布轨选择。只记**本仓库实测过的 profile 依赖因果与配方**；官方解析细节与通用说明不在这里维护（查官方参考源）。
> 版本无关的工具链坑（tsbuildinfo、oxc 解析等）见 [migration-hygiene](../../plugin-upgrade/references/migration-hygiene.md)，本文不重复。

## 1. 两条安装轨的解析事实

| 声明                | 解析行为                                                             | 本仓库用途         |
| ------------------- | -------------------------------------------------------------------- | ------------------ |
| `link:<绝对路径>`   | 目录 junction/symlink 直指本地目录，**不做版本解析**                 | 开发期、批量迁移期 |
| `github:owner/repo` | 解析默认分支 HEAD，lockfile 记录 codeload 归档 URL 的**精确 commit** | 发布安装、消费者侧 |

两轨可在同一 profile 内混用；改名、迁移、收尾按下面各条处理。

## 2. github 依赖的锁缓存坑：`Already up to date` ≠ 拿到了新 commit

- **症状**：上游推了新 commit，`pnpm install` 打印 `Already up to date`，lockfile 里 codeload URL 仍是旧 commit，启动加载的还是旧代码。
- **根因**：pnpm 缓存 github 依赖的 HEAD 解析，普通 `install` 不会重新解析。
- **修法**：对该依赖强制重解析并核对 commit（web / headless profile 各跑一次）：

  ```sh
  cd "$DSH_HOME/profiles/web" && pnpm update <pkg>
  grep 'codeload.*<pkg>' pnpm-lock.yaml   # 应为 tar.gz/<40 位 commit>
  ```

批量迁移收尾时，每个 github 轨依赖都跑一次 `pnpm update` 再核对 commit。

## 3. 包改名（前缀变更）三处同步

包名从 `@deepseek-ai/dsh-x` 变成 `@org/dsh-x` 时，三处必须一致，否则 Loader 解析失败：

1. profile `package.json` 的 dependencies key（安装名）；
2. profile `dsh.profile.bundles` 条目（bundle 名）；
3. 插件自身 `cordis.patch.yml` 的 `name` 行。

**残留清理**：改名后 `pnpm install` 可能保留旧名目录 junction（新旧目录并存）；确认 lockfile 只剩新名后，手工删除残留的 `node_modules/@旧前缀/旧包` 目录。

## 4. junction 语义与共享 fallback

- **junction 指向本地工作区包时，仓库工作树就是已装副本**——不需要任何复制步骤，也不需要 rename-aside；绕过未解析路径去 rename 等于移走唯一副本。宿主侧产物改动**重启 `dsh web` 才生效**，之后 client 侧才谈硬刷新（见 [migration-hygiene](../../plugin-upgrade/references/migration-hygiene.md) 第 3 条）。
- profile 自己的 `node_modules` 只含本 profile 声明的依赖；裸行名解析失败会回退到共享的 `$DSH_HOME/profiles/node_modules`（各 bundle 声明依赖的副本）。
- profile 根 `cordis.yml` 在启动时被改写成 `[]`（配置事实在 patch 层）——**不要手工编辑它**，要改 composition 就改 `cordis.patch.yml`。

## 5. 构建期烘焙的版本常量：打 tag 前必须重建，否则 tag 自相矛盾

- **症状**：发布 `vX.Y.Z+1` 后，_latest_ 的消费者点更新芯片装上新 tag，芯片**仍然**提示有 `vX.Y.Z+1` 可更新；README 矩阵、git tag、`package.json` 都说新版本，只有运行中的插件不同意。
- **根因**：插件在**源码**里 `import pkg from '../../package.json'` 读版本，而发布的是**构建产物**（`lib/client.js`）——打包器在构建时把当时的版本字符串**烘进产物**。只 bump manifest + 打 tag 而不重建，就发出一个 manifest 说 `X.Y.Z+1`、产物仍带 `X.Y.Z` 的自相矛盾 tag；所有读产物的版本比较面（更新芯片、about 面板、诊断）从此永远比出"有更新"。**提交构建产物（`lib/` 入库）的仓库踩得最狠**——"只改 manifest"看起来像一次完整的纯文档发版。
- **修法**：① **bump → 重建 → 一起提交**，再打 tag（纯文档发版时，重建后的 bundle 就是本次唯一的实质变更）；② **加门禁**：从构建产物里提取更新检查真正消费的版本常量，要求与 `package.json.version` **字符串精确相等**（含 prerelease 与 build metadata），缺失/歧义/不匹配即阻断打 tag——整包 grep 不够（`0.3.1` 也会命中 `0.3.1-rc.1`，依赖的版本也不代表插件版本）。
- **已推错 tag 的补救**：先记录每个镜像当前 branch/tag ref OID → 重建、amend（或补 fix commit）、重指 tag → 用**分离的显式租约**把分支与 tag 一起推：

  ```sh
  git push --atomic \
    --force-with-lease=refs/heads/<branch>:<old-branch-oid> \
    --force-with-lease=refs/tags/<tag>:<old-tag-oid> \
    <remote> refs/heads/<branch>:refs/heads/<branch> refs/tags/<tag>:refs/tags/<tag>
  ```

  注解 tag 的租约要写 **tag 对象 OID**，不是 peeled commit SHA；租约失败即停下看并发改动，**不要改 `-f` 重试**。只在该 tag 足够新、固定它的消费者已知时适用，否则直接发 `X.Y.Z+2`。

## 6. 插件版本按 DSH 版本分轨（挑错直接崩）

- **症状**：console 报 `TypeError: useConversation is not a function`（或其他"某个 slot 席位不存在"）；重启、热重载、改 `cordis.patch.yml` 都无效。
- **根因**：DSH client API **跨 rc.x → alpha.x 不向前兼容**——为较新轨构建的插件装进较旧轨宿主后不会优雅降级，而是读一个宿主从未提供的席位，**崩在看起来与插件无关的地方**。
- **修法**：按 DSH 版本挑插件版本，README 顶部放一眼可见的版本矩阵；**不要只给"装 latest"**（那会把 rc.x 用户送到向前不兼容的构建上）。README 里再给一条自检线索（"挑错会崩、典型症状 `useConversation is not a function`"）。

## 7. 文档引用的每个 tag 必须存在于每个镜像

- **症状**：按 README 固定 tag 安装失败：`Could not resolve vN.N.N to a commit of ...`。
- **根因**：仓库分发在多个镜像（私有主仓 + 公开镜像）上，而发布/同步脚本只推分支、从不推 tag，历史 tag 从未到达公开镜像。
- **修法**：① 同步脚本每次推分支后追加 `git push <remote> --tags`（非强制）；② 消费者先用 `git ls-remote --tags <repo>` 确认 tag 存在。发版后自检：按 tag 逐个查 `repos/<org>/<repo>/git/refs/tags/<tag>`，缺的重推——与第 2 条同类："文档说能装，就必须真的能装"。

## 8. 插件内更新提示必须自带分轨与救援信息

- **症状**：消费者点插件"有新版本"芯片、粘贴复制的更新提示，agent 照字面执行——装到该 tag 从未适配的 DSH 版本上，或装失败时完全不知道去哪查；README 的版本矩阵此时完全不在视野里（**提示词是用户那一刻唯一的指引**）。
- **修法**：芯片复制的提示必须自足——① 第 0 步先 `dsh --version` 对 README 兼容表，tag 与消费者 DSH 不匹配就改装表里匹配的 tag；② 带固定 tag 的安装命令 + pnpm 11 `approve-builds` 逃生口；③ 装后硬刷新提醒；④ 最后一步：装失败/版本不匹配/启动报错先查 README 的兼容与已知限制节。一个插件族共用一个提示模板（只有包名与仓库 URL 不同），改口径只发一次；提示词措辞变更按行为变更对待（bump + 发版，让芯片把它分发出去）。

## 9. 验证清单

- [ ] 每个 github 依赖在 lockfile 里的 commit == 期望 HEAD；
- [ ] 改名插件在 lockfile / bundles 列表 / `cordis.patch.yml` 三处同名，旧目录 junction 已清；
- [ ] `dsh --profile <p> --dump-config` 的行集符合预期；
- [ ] 真实冷启动后 entry active、无 pending；
- [ ] 构建产物里烘焙的版本常量 == `package.json.version`（第 5 条）。
