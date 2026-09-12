---
title: CI 日志取证静默缺项
description: ghops actions logs 依赖 run 归档导致 job 静默缺失、失败 job 日志 403 的根因与正确取证姿势
created: 2026-09-12
updated: 2026-09-12
---

# CI 日志取证静默缺项

> 状态：**已解决**（工具侧修复，2026-09-12，issue [#224](https://github.com/baosfeng/my-dsh-plugins/issues/224)）
> 影响面：所有以 `ghops actions logs` 为取证第一步的 CI 排查流程——本仓库「AI 排查 CI flaky」的关键路径

## 现象

排 #217 的 CI 失败时，`ghops actions logs baosfeng/my-dsh-plugins 34696966097` 返回了 8456 行日志，
但日志集合里**唯独没有失败的那个 job**（`test (dsh-my-guardian)`，集合里只有名字近似的前缀
`dsh-my-guard`，两者是不同插件）。拿到的是一个「看起来完整、其实缺了最关键一项」的集合 →
「红在哪一行」的直接证据拿不到，排查只能转去审「断言是否依赖墙钟」，成本极高。

另一起（#194）：下载失败 job 的日志直接 **API 403**，同样无法取证。

## 根因

### 1. 拿 run 归档当 job 清单（静默缺项，主因）

`actions logs` 原先只做一件事：下载 `/repos/{owner}/{repo}/actions/runs/{id}/logs` 的 zip，
把 `namelist()` 的条目逐个打印。**它从不查 `/actions/runs/{id}/jobs`**，于是：

- **run 归档不是权威 job 清单**。归档由 GitHub 按需生成/缓存，可能不包含尚未结束、或日志尚未
  上传完成的 job。本 issue 复跑时归档已含全部 23 个 job（46 个条目、612 KB），但事发当时的输出是
  8456 行 / 389 KB 的另一份内容——**同一个 run 的归档在不同时刻内容不同**，事发那次就是残缺的。
- 输出格式是 `===== <条目名> =====`，**既不对账也不计数**：缺了哪个 job 完全看不出来。
- 顺带排除一个假设：旧代码里**没有任何名称匹配逻辑**，"前缀匹配导致 `dsh-my-guardian` 被
  `dsh-my-guard` 吞掉"**不成立**。真正的缺陷是**信任了一个非权威来源、且从不做交叉校验**。

静默缺项比报错危险得多——它会直接把排查方向带偏。

### 2. 失败 job 日志 403

`/repos/{owner}/{repo}/actions/jobs/{job_id}/logs` 在**请求未带凭据**（或 token 权限不足）时返回：

```json
{ "message": "Must have admin rights to Repository.", "status": 403 }
```

实测（2026-09-12）的关键点：

- **与仓库权限无关**：对一个完全公开的仓库（`actions/checkout`）匿名请求该端点**同样是 403**；
  带上本机凭据后，公开仓库与私有仓库都返回 **302 → 200**。所以这 403 = **调用方没带凭据**，
  不是"需要仓库 admin"。
- 该端点会 **302 跳到签名 URL**：必须跟随重定向，用 `curl` 不加 `-L` 只会拿到空的 302 响应。

## 正确姿势（修复后）

```bash
# 1) 先问「这个 run 到底有哪些 job」——以 jobs API 为准，全量分页
ghops actions logs owner/repo <run-id> --jobs

# 2) 再精确取失败 job 的日志（接受 job id / 完整名称 / 名称子串）
ghops actions logs owner/repo <run-id> --job "test (dsh-my-guardian)"

# 3) 全量 dump 也可以，但必须看 stderr 的覆盖报告
ghops actions logs owner/repo <run-id>
#    —— job 清单：23 个；本次请求 23 个，日志已获取 23 个 ——
```

修复要点：

- job 清单改由 `/actions/runs/{id}/jobs` **全量分页**取得（`per_page=100` 翻到底，并与 `total_count` 对账）；
- 归档里缺的 job **自动用单 job 端点补齐**，补齐块明确标注 `（单 job 补取）`；
- 补齐也失败时**明确报告**：job 名 + id + HTTP 原因 + 网页替代路径；用 `--job` 显式指定却取不到时
  **退出码 6**（全量 dump 有单个缺项则如实计数并继续，不中断取证）；
- 覆盖报告一律输出到 **stderr**，stdout 保持纯日志（`| grep` 不受影响）；
- `--job` **精确匹配优先**（id / 完整名），再退化为子串匹配，**绝不前缀匹配**；
- `--archive` 保留旧输出（与修复前**字节完全一致**），仅作兼容。

## 替代取证路径（日志确实取不到时）

| 路径          | 说明                                                                               |
| ------------- | ---------------------------------------------------------------------------------- |
| 先列 job 清单 | `ghops actions logs owner/repo <run> --jobs`——**不要**从归档内容反推 job 清单      |
| 单 job 端点   | `ghops actions logs owner/repo <run> --job <id>`（ghops 已自动带凭据并跟随重定向） |
| run 归档端点  | `/actions/runs/<id>/logs`，一次拿全部 job；ghops 默认已在用                        |
| 网页直看      | `https://github.com/owner/repo/actions/runs/<run-id>/job/<job-id>`                 |
| 失败步骤摘要  | `ghops actions list owner/repo` 定位 run → `--jobs` 找到红色 job → `--job` 取正文  |

## 同类问题：告警的「0 条 ≠ 不存在」

同一个「静默缺项」模式也出现在安全告警（issue #214）：`ghops alerts --state open` 只打印
「Dependabot 0 条」，对**已关闭 / auto_dismissed** 的告警只字不提 → leader 据此写下
「Dependabot 未覆盖该链路」的错误结论（实际有 2 条 qs 告警被平台 `auto_dismissed`）。
修复后 open 视图会追加一行：

```text
⚠ 【Dependabot 依赖漏洞】另有 3 条**已关闭**告警未显示（该视图只列打开中的）；
  复查：ghops alerts owner/repo --state closed —— 平台 auto-dismiss 的可能仍然受影响
```

同时 `--state closed` 现在会**显式带 state 查询值**：secret-scanning 端点默认只返回 open，
不显式传 `resolved` 就永远看不到已解决告警（修复前 `--state closed` 对它是失效的）。
提示默认开启，`--no-closed-hint` 可关；**只有某类告警显示 0 条时才多发一次请求**，
正常（有 open 告警）情况下零额外开销。单页达到 `--limit` 上限时也会提示可能还有更多。

**通用原则：宁可多提示一次，也不要让使用者把「没有」当成「不存在」。**

## 防回归

工具旁自测 `scripts/test_ghops_224.py`（与 `ghops.py` 同目录，`python3 test_ghops_224.py`，21 项断言）：

- 150 个 job 跨 2 页 → 全量列出（`total_count` 对账）；
- 归档缺 3 个 → 自动补齐，覆盖计数 150/150；
- 归档缺 + 单 job 403 → 报告 job 名/id/原因/替代路径，`--job` 取不到时退出码 6；
- 前缀陷阱：`dsh-my-guard` 不被当成 `dsh-my-guardian`；
- alerts：open 视图 0 条且存在已关闭告警 → 必须提示 `--state closed`。

## 关联

- issue [#224](https://github.com/baosfeng/my-dsh-plugins/issues/224)（本页）、[#217](https://github.com/baosfeng/my-dsh-plugins/issues/217)（案例 A 来源）、[#194](https://github.com/baosfeng/my-dsh-plugins/issues/194)（案例 B 来源）、[#214](https://github.com/baosfeng/my-dsh-plugins/issues/214)（告警同类问题）
- [固定sleep等异步落盘导致CI-flaky](固定sleep等异步落盘导致CI-flaky.md) — CI 排查方法论，取证是其第一步
- [npm-audit在镜像源下静默失效](npm-audit在镜像源下静默失效.md) — 同属「工具静默缺项导致假阴性」
- github-ops skill（**仓库外**，未入本仓库版控）：`~/Documents/skills/github-ops/SKILL.md` + `scripts/ghops.py`
