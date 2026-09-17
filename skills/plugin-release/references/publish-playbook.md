# publish-playbook · 发布语义不变量与真实坑位

> 承接 [../SKILL.md](../SKILL.md) 的发布决策流；只放**发布语义不变量**与**实测坑位**，通用打包/分发说明不在这里维护。

## 发布语义四不变量

发布前按序跑，任一失败即停（与 [../scripts/verify-release.mjs](../scripts/verify-release.mjs) 一一对应；该脚本只校验入参，**不发布、不打 tag、不联网**）：

```sh
VERSION="$(node -p "require('./package.json').version")"
# 1) GitHub Release tag 必须等于 v${VERSION}
[ "$RELEASE_TAG" = "v$VERSION" ] || { echo "tag mismatch"; exit 1; }
# 2) prerelease 状态必须一致（'-' 在 '+' build metadata 之前）
V_PRERELEASE="$(node -e 'console.log(process.argv[1].split("+")[0].includes("-") ? "true" : "false")' "$VERSION")"
[ "$RELEASE_PRERELEASE" = "$V_PRERELEASE" ] || { echo "prerelease state mismatch"; exit 1; }
# 3) dist-tag 分轨：prerelease 只进项目声明的非 latest tag（NEXT_TAG 由项目定）；stable 才进 latest
if [ "$RELEASE_PRERELEASE" = "true" ]; then NPM_TAG="$NEXT_TAG"; else NPM_TAG="latest"; fi
# 4) stable 发布前拒绝把 latest 回退到更低版本（semver 比较）
if [ "$NPM_TAG" = "latest" ]; then
  CURRENT="$(npm view "$PKG" dist-tags.latest 2>/dev/null || echo 0.0.0)"
  node -e "const semver=require('semver'); if (semver.lt(process.argv[1], process.argv[2])) { console.error('refusing to move latest backwards'); process.exit(1) }" "$VERSION" "$CURRENT"
fi
npm publish --access public --tag "$NPM_TAG"
```

验收矩阵与发布通道对应：prerelease 通道固定 alpha 系 tag、stable 通道固定 rc 系 tag——**绝不跟 master/main 冒充验收**。

## 真实坑位

| 坑                                                             | 症状                                                                     | 处置                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| pnpm 不在 PATH（只有 corepack）                                | 构建脚本里嵌套 `pnpm --filter …` 报 `'pnpm' is not recognized`           | 生成转发到 corepack 的 `pnpm.cmd` 垫片并置于 PATH 前；启动/构建包装脚本负责 bootstrap     |
| Windows PowerShell 5.1 把 `npm` 解析成 `npm.ps1`               | 参数被吞（`Unknown command: "pm"`）                                      | 包装脚本显式调用 `npm.cmd` / `pnpm.cmd`                                                   |
| PowerShell 5.1 默认参数值里 `$PSScriptRoot` 为空（带 `[CmdletBinding()]`） | `Join-Path` 收到空字符串报错                                             | 把默认值解析移到脚本体内                                                                 |
| PowerShell 只读自动变量 `$Host`                                | 参数 `-Host` 无法覆盖                                                    | 改名，例如 `-BindHost`                                                                   |
| `git rebase --continue` 卡在编辑器                             | 无 TTY 时挂住                                                            | 续前设 `GIT_EDITOR=true`（或 `core.editor=true`）                                        |
| 远端已前进、推送被拒                                           | `[ahead 1, behind 1]`                                                    | `git pull --rebase` 后用 `--force-with-lease` 重推；**绝不裸 `--force`**                  |

> 发布前 Web Client 插件的冒烟最低面：宿主 boot 名单（`window.__DSH_BOOT__`）里的 bundle 入口可达、bundle 注册成功、DOM 挂载完成、无 page error——`--dump-config` 只证明行存在，不替代这一检查。

## 回滚配方

1. 发布前先打 tag 并记录 lockfile / composition 基线 hash；
2. GitHub 直装轨：删除或移动 tag，消费者按需重指回旧 commit；
3. 迁移与发布都在隔离工作区（branch/worktree）里做，**不和功能改动混在一个 commit**；
4. 失败时只回滚本次拥有的路径（tag、lockfile、manifest），并报告第三方安装脚本的残留副作用。
