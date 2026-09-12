---
title: npm audit 在镜像源下静默失效
description: npmmirror 不支持 audit 端点 + CI 只阻断 high + Dependabot 自动关闭，三重叠加导致 moderate 漏洞无人发现
created: 2026-09-12
updated: 2026-09-12
---

# npm audit 在镜像源下静默失效

> **状态：已解决**（2026-09-12，issue #199）—— 升级 qs 到 6.16.0 消除漏洞，CI 门禁把 audit-level 提为 moderate 并钉住官方 registry，本地 `--audit` 改为「先证明真查过、再判结果」。

## 现象

`npm audit` 报出 2 条 moderate（`qs`，经 `@stryker-mutator/core` → `typed-rest-client` 传入），
但**长达数周无人发现**。四条可见渠道同时失效：

| 渠道                   | 当时的表现                                 | 为什么失效                                                                |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| 本机 `npm audit`       | `[NOT_IMPLEMENTED] /-/npm/v1/security/*`   | npmmirror **未实现** security advisories 端点，本地 audit 根本不可用      |
| GitHub Dependabot 面板 | 显示 **0 条 open 告警**                    | 告警其实创建过，但以 `auto_dismissed` 状态自动关闭（见下），默认只列 open |
| CI `npm audit` job     | 通过（打印 "2 moderate" 但不阻断）         | 门禁设成 `--audit-level=high`，**moderate 只打印不阻断**                  |
| CI `npm ci` 输出       | 打印 "2 moderate severity vulnerabilities" | npm install 后的提示不阻断构建，被忽略                                    |

## 根因（四层叠加，缺一层都不会漏）

1. **镜像没有 audit 端点**：`npm audit` 依赖 `POST /-/npm/v1/security/advisories/bulk`；
   npmmirror 返回 `404 [NOT_IMPLEMENTED]`。本机 `~/.npmrc` 的 `registry=https://registry.npmmirror.com`
   让本地 audit 直接失效。
2. **`--registry` 会被反向重写**（本次最反直觉的一点）：npm 的 `replace-registry-host` 默认值 `npmjs`
   会把 `registry.npmjs.org` 的地址**换成当前配置的 registry**。所以「显式指定官方源」这种直觉做法
   **无效**——它会被改回镜像。必须同时设 `replace_registry_host=never`。
3. **CI 门槛过松**：`--audit-level=high` 放行 moderate。对 npm 而言，未达 `--audit-level` 的漏洞
   **不影响退出码**（实测：moderate 漏洞 + `--audit-level=high` → exit 0，同时打印 "2 moderate"）。
4. **只看退出码无法区分「没查」和「干净」**：镜像下 audit 也会以非 0/0 退出并打印提示，
   与「真的查过且没问题」在退出码层面没有区别——判定必须基于输出里**确实有结构化报告**。

## Dependabot 的真实行为（纠正一个常见误解）

面板显示 0 条 **open** 告警 ≠ 没报过。查 `ghops alerts <repo> --state closed` 可以看到：

```text
#3 [auto_dismissed/medium] qs array-limit bypass via bracket-key comma parsing（GHSA-x5fp-wj9c-mxmx）
#2 [auto_dismissed/medium] qs: DoS via Attacker Controlled isBuffer（GHSA-4mjr-xmp4-gh2g）
```

两条都在 `created_at == auto_dismissed_at`（2026-09-02T16:05:37Z，同一秒）被自动关闭，
`dismissed_by` / `dismissed_reason` 均为空 —— 即 GitHub 的**自动关闭**（传递依赖 + development scope）。
结论：**Dependabot 覆盖了这条链路，但它的告警以 closed 状态存在，只看 open 列表会误判为「没报」。**

## 复现

```bash
# 1. 本机镜像下 audit 直接失效（记下它只说明「没查成」，不是「没问题」）
npm audit --registry=https://registry.npmmirror.com
#   npm warn audit 404 Not Found - POST .../security/advisories/bulk - [NOT_IMPLEMENTED] ...

# 2. 显式指定官方源也会被重写回镜像（坑点 2）
npm audit --registry=https://registry.npmjs.org     # 仍然是 npmmirror 的请求

# 3. 正确姿势：官方源 + 禁止重写（+ 代理，若本机需要）
HTTPS_PROXY=http://127.0.0.1:7890 \
  npm_config_registry=https://registry.npmjs.org \
  npm_config_replace_registry_host=never \
  npm audit --audit-level=moderate

# 4. 已关闭的告警也要看（面板默认只显示 open）
ghops alerts <owner/repo> --state closed --kind dependabot
```

## 修复

| 环节     | 改动                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 漏洞本身 | `package.json` overrides `qs` 6.15.3 → **6.16.0**（lockfile 仅 3 行变动）；不升 `typed-rest-client`，避免动 `@stryker-mutator/core` 的 pinned `~2.3.0` 约束              |
| CI 门禁  | `.github/workflows/ci.yml` audit job：`--audit-level=high` → **`moderate`**，并显式钉住官方 registry（`npm_config_registry` + `npm_config_replace_registry_host=never`） |
| 本地门禁 | `scripts/verify-local.mjs` 的 audit 项：钉官方 registry、与 CI 同门槛，且**先校验输出确有结构化报告**（`scripts/lib/npm-audit.mjs`），未真正执行即判失败并打印原因       |
| 防回归   | `scripts/test/npm-audit.test.mjs`（27 例，含「退出码 0 但无报告 → 判未执行」的假绿用例）                                                                                 |
| 文档     | 本文 + [构建与测试](../开发指南/构建与测试.md)的 audit 说明与自查清单                                                                                                    |

## 教训

- **「没查成」必须与「查过且干净」区分开**。只信退出码的门禁，在数据源不可达时会静默变成假绿。
- **改 registry 的直觉做法会失效**：`--registry` 受 `replace-registry-host` 重写规则支配，必须显式关掉重写。
- **门禁的 severity 阈值是设计决策，不是默认值**：`high` 看似「抓大放小」，实际让 moderate 长期沉积。
- **告警面板的默认筛选会骗人**：`auto_dismissed` / `fixed` 都不出现在 open 列表里，排查时务必带 `--state closed`。
- 一个漏洞能同时绕过 4 条渠道，说明**渠道之间没有交叉校验**；现在的做法是让「本地 audit」与「CI audit」共用同一套判定件（`scripts/lib/npm-audit.mjs`），避免两处各写一份、再次跑偏。

→ [索引.md](../索引.md) ｜ [构建与测试](../开发指南/构建与测试.md)
