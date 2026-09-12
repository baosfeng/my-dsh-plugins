---
title: Dependabot 自动关闭告警造成假阴性
description: npm development 传递依赖告警被 GitHub 自动关闭后不出现在 open 视图；依赖升级还会把 auto_dismissed 覆盖成 fixed 并清空时间戳，历史证据消失
created: 2026-09-12
updated: 2026-09-12
---

# Dependabot 自动关闭告警造成假阴性

> **状态：机制已落地**（2026-09-12，issue #214）—— 巡检入口强制复查已关闭告警（`skills/dsh-github-triage/scripts/check-dependabot-closed.sh`，含 13 例防回归自测）；漏洞本身已由 #199 修复。**仓库设置是否要调整需网页侧确认**（见文末）。

## 现象

本仓库两条 `qs` 告警（#2 GHSA-4mjr-xmp4-gh2g、#3 GHSA-x5fp-wj9c-mxmx）在 2026-09-02T16:05:37Z 被 GitHub **自动关闭**：

- `ghops alerts <repo> --state closed --kind dependabot` 当时显示两条都是 `auto_dismissed`；
- `created_at == auto_dismissed_at`（**同一秒**），`dismissed_by` / `dismiss_reason` 均为空 → 非人工操作；
- 而默认视图 `ghops alerts <repo> --state open` 显示「Dependabot 0 条」，**与「根本没报」在表面上无法区分**。

**这次假阴性已经造成真实误判**：#199 排查时说「Dependabot 未覆盖该链路」，实际是「报了但被自动关闭」——同一个漏洞从 09-02 关闭到 09-12 被发现，整整 10 天没有出现在任何默认入口里。

## 根因（三条独立事实链，全部可复现）

**① 是 GitHub 的机制行为，不是仓库里的代码/配置**

| 证据                        | 内容                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub 官方 changelog       | [Dependabot alerts now automatically dismiss false positives for npm](https://github.blog/changelog/2023-05-02-dependabot-alerts-now-automatically-dismiss-false-positives-for-npm-public-beta/)：Dependabot 会 auto-dismiss **npm devDependency 告警（`scope:development`）**中「影响有限或不太可能被利用」的那些，**公开仓库 on-by-default**、私有仓库 opt-in，官方预期约 15% 的低影响 npm 告警被自动关闭 |
| GitHub 官方文档             | [Dependabot auto-triage rules](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-auto-triage-rules)：自动关闭的活动会出现在 webhooks / REST / GraphQL / audit log，并可用 closed 列表的 `resolution:auto-dismissed` 过滤器复查；**当告警元数据变化（例如依赖 scope 改变、不再满足条件）时告警会自动重新打开**                                                              |
| 本次 API 实测（2026-09-12） | `ghops alerts baosfeng/my-dsh-plugins --state closed --kind dependabot --json`：#2 / #3 的 `dependency` = `scope: development`、 `relationship: transitive`、manifest = `package-lock.json`；引入链 `@stryker-mutator/core` → `typed-rest-client` → `qs`（全链 `dev: true`）——**完全命中官方描述的 devDependency 传递依赖**                                                                                 |

**② 关闭理由与事实不符 → 误关**

告警被关闭时，`package-lock.json` 里的 `qs` 是 **6.15.3**：

- #2 的受影响范围 `>= 2.2.5, < 6.16.0` → 6.15.3 **命中**；
- #3 的受影响范围 `>= 6.14.2, <= 6.15.3` → 6.15.3 **命中**。

也就是说「低影响 / 不太可能被利用」的判断在本仓库不成立：这两个 DoS 都经 `qs` 的解析入口，而 CI/测试链天天在跑它。直到 2026-09-12 的 #199（overrides `qs` → 6.16.0，PR #213）才真正修掉。

```bash
# 复核命令（当时的确切结论）
git show 92f270d^:package-lock.json | grep -A 2 '"node_modules/qs"'   # → 6.15.3（受影响）
git show 92f270d:package-lock.json  | grep -A 2 '"node_modules/qs"'   # → 6.16.0（已修复）
```

**③ 更隐蔽的一层：auto_dismissed 的历史会被 fixed 覆盖掉**

2026-09-12 依赖升到 6.16.0 之后，#2 / #3 的 `state` 变成 `fixed`，`auto_dismissed_at` / `dismissed_at` / `dismissed_by` / `dismiss_reason` **全部变回 null**——事后从 API 已经完全看不出「它曾被自动关闭过」：

```text
# 2026-09-12 复跑同一命令（当时 issue #214 正在排查，状态已经变了）
$ ghops alerts baosfeng/my-dsh-plugins --state closed --kind dependabot --json | jq -c \
    '.dependabot[] | {number, state, created_at, auto_dismissed_at, fixed_at}'
{"number":3,"state":"fixed","created_at":"2026-09-02T16:05:37Z","auto_dismissed_at":null,"fixed_at":"2026-09-12T13:20:40Z"}
{"number":2,"state":"fixed","created_at":"2026-09-02T16:05:37Z","auto_dismissed_at":null,"fixed_at":"2026-09-12T13:20:40Z"}
{"number":1,"state":"fixed","created_at":"2026-08-24T14:55:41Z","auto_dismissed_at":null,"fixed_at":"2026-08-24T15:46:16Z"}
```

结论：**「现在查不到 `auto_dismissed`」不能证明「从来没被自动关闭过」**。要复原自动关闭这段历史，只能去告警详情页看 timeline（webhooks / audit log 另有留存，但 ghops 未封装这两个端点）。

## 无法判定、需要网页侧确认的部分

以下两项**无法从 ghops 提供的 API 读出**，本次也没能通过浏览器确认（agent-browser 的浏览器实例没有 GitHub 登录态，`github.com/.../settings/security_analysis` 与告警详情页都会落到登录页）。请人工确认：

1. **仓库的 Dependabot 自动关闭开关**：打开 <https://github.com/baosfeng/my-dsh-plugins/settings/security_analysis> → Dependabot alerts 区域，确认是否有 auto-dismiss 相关开关及其状态。官方说明：公开仓库 **on-by-default**，私有仓库需 opt-in，管理员可在 Code Security 页调整。
2. **是否存在自定义 auto-triage 规则**：打开 <https://github.com/baosfeng/my-dsh-plugins/security/dependabot>（Auto-triage rules 入口）或仓库 **Settings → Code security → Dependabot**，确认有没有自定义规则把范围放得比 GitHub 预设更宽。
3. **告警 #3 详情页的 timeline**：<https://github.com/baosfeng/my-dsh-plugins/security/dependabot/3>，确认能否看到 auto-dismissed 事件（能看到就说明历史事件仍在，可作为证据存证）。

## 机制修复（本 issue 的核心增量）

| 落点                                                                    | 内容                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/dsh-github-triage/SKILL.md`                                     | 「第一步：收集问题」新增 🔴 必做项 + 「Dependabot 已关闭告警必须单独复查」小节：为什么查、一条命令怎么查、判读规则表（auto_dismissed / ⚠ 仍受影响 / ✔ 已修复 / fixed 覆盖）、派发 prompt 必带项                           |
| `skills/dsh-github-triage/scripts/check-dependabot-closed.sh`           | 一键入口：调 `ghops alerts --state closed --kind dependabot --json` 再交给巡检脚本                                                                                                                                        |
| `skills/dsh-github-triage/scripts/check-dependabot-closed.py`           | 列出**全部已关闭**告警（`fixed`/`dismissed`/`auto_dismissed`）→ 逐个核对本地 lockfile 里该依赖的**实际版本是否仍落在** `vulnerable_version_range` 内 → 打印引入链与「非人工关闭」标记 → 退出码 1 = 有「已关闭但仍受影响」 |
| `skills/dsh-github-triage/scripts/test/test_check_dependabot_closed.py` | 13 例防回归自测：auto_dismissed 仍受影响必须退出 1、已升修复版退出 0、无告警时也必须打印「不能证明没报过」的警告、范围解析边界、垃圾输入必须显式报错                                                                      |
| 本文件 + `docs/踩坑/README.md`                                          | 结论与确认步骤落档；与 [npm audit 在镜像源下静默失效](npm-audit在镜像源下静默失效.md) 互为姊妹篇（那条讲「查不成」，这条讲「查到了但看不见」）                                                                            |

## 复现 / 巡检

```bash
# 1) 巡检脚本：列出全部已关闭告警 + 核对本地 lockfile（只读）
cd <仓库工作区>
bash skills/dsh-github-triage/scripts/check-dependabot-closed.sh baosfeng/my-dsh-plugins .

# 2) 自测（13 例，含用 #199 修复前的真实 lockfile 复现）
python3 skills/dsh-github-triage/scripts/test/test_check_dependabot_closed.py

# 3) 最小手工版：只看已关闭告警本身
ghops alerts baosfeng/my-dsh-plugins --state closed --kind dependabot
```

### 用 #199 修复前的真实数据复跑（机制有效性验证，2026-09-12 实测）

把当时（`auto_dismissed`）的告警 JSON 与当时的 lockfile（`qs` 6.15.3）配在一起复跑——**这两条已关闭告警会被自动浮现并标记为「仍受影响」**：

```bash
set -e
WORK=$(mktemp -d)                       # 隔离的 lockfile 环境，不动主工作区
cd <仓库工作区> && git show 92f270d^:package-lock.json > "$WORK/package-lock.json"
ghops alerts baosfeng/my-dsh-plugins --state closed --kind dependabot --json > "$WORK/closed-now.json"
python3 - "$WORK" <<'PY'               # 还原 issue 时刻的告警状态（#2/#3 当时是 auto_dismissed）
import json, sys
work = sys.argv[1]
data = json.load(open(work + '/closed-now.json'))
for a in data['dependabot']:
    if a['number'] in (2, 3):
        a.update(state='auto_dismissed', auto_dismissed_at='2026-09-02T16:05:37Z',
                 fixed_at=None, dismissed_at=None, dismissed_by=None, dismissed_reason=None)
json.dump(data, open(work + '/closed-at-incident.json', 'w'), ensure_ascii=False)
PY
python3 skills/dsh-github-triage/scripts/check-dependabot-closed.py \
    "$WORK/closed-at-incident.json" --repo-dir "$WORK"; echo "EXIT=$?"   # → 1
```

实测输出（节选）：

```text
已关闭告警：2 条

#2  [auto_dismissed]  medium  qs
    受影响范围 : >= 2.2.5, < 6.16.0    修复版本: 6.16.0
    时间       : created=2026-09-02T16:05:37Z closed=2026-09-02T16:05:37Z auto_dismissed=2026-09-02T16:05:37Z
    关闭者     : （空=非人工） / （空）
    本地核对   : ⚠ 仍受影响  lockfile 中 6.15.3，落在 >= 2.2.5, < 6.16.0 内；由 typed-rest-client 引入

#3  [auto_dismissed]  medium  qs
    本地核对   : ⚠ 仍受影响  lockfile 中 6.15.3，落在 >= 6.14.2, <= 6.15.3 内；由 typed-rest-client 引入

⚠ 需人工判读：2 条已关闭告警的依赖仍以受影响版本存在于 lockfile ——
   #2 qs (auto_dismissed) → https://github.com/baosfeng/my-dsh-plugins/security/dependabot/2
   #3 qs (auto_dismissed) → https://github.com/baosfeng/my-dsh-plugins/security/dependabot/3
EXIT=1
```

**注意（本次实测的关键观察）**：对**当前**状态复跑同一命令，结果是 `✔ 已升到修复版 / EXIT=0`——因为依赖升到 6.16.0 后 GitHub 把 `state` 从 `auto_dismissed` 改成了 `fixed`，`auto_dismissed_at` 被清空。**机制的时效性来自「在依赖还没升级时跑它」**：一旦升级完成，自动关闭这段历史就只剩告警详情页 timeline 能看到了。

## 设置调整建议（**建议，未改动**；需人工在网页侧确认后执行）

- **若是 GitHub 预设的 on-by-default 自动关闭**（最可能）：公开仓库无法只关这一条预设规则本身；可行的做法是把复查机制固化（本 issue 已做）+ 依赖升级策略提前（Dependabot 版本更新 PR 别长期挂着），必要时把关键 devDependencies 用 `overrides` / 直接 devDependency 钉到修复版本，让告警根本没有机会产生。
- **若仓库里存在自定义 auto-triage 规则把范围放得比预设更宽**：在 Settings → Code security → Dependabot → Auto-triage rules 里收窄或删除该规则（该页面只能人工操作，本次未改）。
- **不建议**为了让告警留在视野里而关闭整个 Dependabot：本次两条告警的**存在本身**正是后来发现问题的线索。

## 教训

- **默认视图是筛过的视图**：「0 条 open」永远不等于「没有」。`auto_dismissed` / `fixed` / `dismissed` 都不在 open 里。
- **自动关闭状态不是终态，而且会被覆盖**：`auto_dismissed` → `fixed` 时 GitHub 会**清空 `auto_dismissed_at`**；任何「只看当前状态」的巡检都可能在事后完全看不到自动关闭历史。要留证据就在发现当时把 JSON 落盘（或存进 issue 评论）。
- **平台的安全判断要拿事实复核**：auto-dismiss 是启发式（npm dev scope 传递依赖），它会误关。复核的最小事实是「lockfile 里的实际版本 vs `vulnerable_version_range`」——这一步已经脚本化，不要靠感觉。
- **一条渠道失效要补两条**：#199 教会我们「查不成 ≠ 干净」，#214 补上「查到了但看不见」；现在本地 audit、CI audit、已关闭告警复查三个渠道交叉验证。

→ [索引.md](../索引.md) ｜ [dsh-github-triage/SKILL.md](../../skills/dsh-github-triage/SKILL.md) ｜ [npm-audit在镜像源下静默失效.md](npm-audit在镜像源下静默失效.md)
