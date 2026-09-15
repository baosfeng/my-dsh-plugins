---
title: secret 扫描门禁（gitleaks）与它自己的坑
description: CI/本地 secret 扫描的落地要点——钉版本+SHA256、绝不回显明文、allowlist 只豁免具体字面量，以及"测试文件自己会被扫出来"这类反身性陷阱
created: 2026-09-15
updated: 2026-09-15
---

# secret 扫描门禁（gitleaks）与它自己的坑

> **状态：已落地**（2026-09-15，issue #324）——`npm run secret:scan`（本地）/ CI `secret-scan` job 同一条命令、同一个二进制。

## 为什么需要（GitHub 原生 secret scanning 不够）

原生 secret scanning 是**事后**告警，而且本仓库已经踩过「告警看着有、其实被静默关掉」的坑：
`docs/踩坑/npm-audit在镜像源下静默失效.md` 记录过 4 条渠道同时失效、漏洞沉积数周。
CI 层扫描的意义是把判定**前移到合并前**：命中即失败，PR 根本进不来。

## 落地形状（一句话）

| 环节        | 做法                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| 扫描器      | gitleaks，**版本 + 发布产物 SHA256 钉死**在 `scripts/ci-tools.json`，下载后校验不符即拒绝执行               |
| 范围        | `gitleaks git <repo> --log-opts --all` → **全历史**（因此天然覆盖本次 diff）                                |
| 规则        | `.gitleaks.toml` 只写 allowlist，规则集用 `[extend] useDefault = true` 继承内置表（避免本地副本陈旧）       |
| 明文        | **绝不进任何输出**：报告走 `--report-path -` 进内存 → 我们自己只渲染 `文件:行:规则`（+提交短 SHA）          |
| 本地入口    | `npm run secret:scan` / `node scripts/verify-local.mjs --only secret-scan`（默认执行，不是可选）            |
| fail-closed | 拿不到二进制、SHA256 不符、报告解析失败、**扫描 0 个提交** —— 一律判失败，只有显式 `--allow-missing` 才跳过 |

## 反身性陷阱：门禁会扫出**它自己的测试**

这是本次开发真实踩到的，值得单独记一笔：

1. `scripts/test/secret-scan.test.mjs` 需要「一条像真凭据的假密钥」来证明门禁会红。
   最直觉的写法是把假 token **写死在源文件里**。
2. 于是**本仓库的 secret 扫描把测试文件自己扫出来了**：
   `scripts/test/secret-scan.test.mjs:123:generic-api-key`。
   用 allowlist 豁免它是最坏选择——那等于在 allowlist 里留一条「放过测试目录里任何高熵串」的口子。
3. 正解：**假 token 在运行时派生**（`sha256('my-dsh-plugins/secret-scan-probe/<seed>').base64url.slice(0,43)`）。
   派生值同样「像真凭据」（熵 4.7-4.9，足以被 `generic-api-key` 检出），但**源码里不存在这串字符**，
   所以扫描器扫不到；测试依然能证明「塞进仓库的假密钥会被拦下」。

> 结论：**给门禁写反例时，反例本身也要满足门禁**。写死的反例要么被豁免（留后门），要么让门禁对自家人变红。

## allowlist 的准入标准（唯一的判断依据）

**只豁免「在仓库里能一眼判定为样例/夹具」的具体字面量，并说明它从哪来。**

- ❌ 禁止 `paths = ['scripts/test/.*']` 这类按目录豁免 —— 以后任何人在测试目录误提交真凭据都会被静默放过。
- ❌ 禁止 `regexes = ['token=.*']` 这类按规则/宽口径豁免。
- ✅ 正确写法：锚定**那一个具体的样例值**，并把 `regexTarget = "match"`（按命中文本片段匹配，
  片段里含 `token=` / `x-remote-token:` 这类上下文关键字，比只匹配密钥本体更精确）。

**为什么这不会被用来放过真凭据**：锚定字面量后，豁免的是「值」而不是「位置/规则」——
把样例值替换成任何别的值（也就是真凭据），正则不再匹配，门禁立刻变红。
`scripts/test/secret-scan.test.mjs` 里有一条用例专门钉死这个性质：
「allowlist 只豁免样例值：把样例换成另一个值，门禁仍然变红」。

当前 6 条豁免全部来自 692 个提交的实测全历史扫描，逐条核对上下文后确认都是本地样例
（本机 loopback 启动 token ×2、测试夹具自造 token ×2、隔离实例自造 token ×1、假私钥片段 ×1）。

## 常见现象 → 处理

| 现象                                             | 原因 / 处理                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `❌ 无法获取 gitleaks：...`                      | 本机网络不通 GitHub。设 `HTTPS_PROXY=http://127.0.0.1:7890` 后重试；或手动下载后用 `--bin <路径>`             |
| `❌ 本机 gitleaks 版本 X 与 ... 钉死的 Y 不一致` | PATH 上装了别的版本。让脚本用缓存/下载的固定版本：`npm run secret:scan`（自动），或 `--refresh` 强制重下      |
| `❌ SHA256 不符，拒绝执行`                       | 下载产物与 `scripts/ci-tools.json` 的校验值不一致 —— **不要**直接改校验值，先确认发布产物是否被替换/中间人    |
| `❌ 报告扫描了 0 个提交`                         | 浅克隆（`fetch-depth: 1`）或范围写错。CI 的 checkout 必须 `fetch-depth: 0`；这就是「没扫成 ≠ 干净」的显式判据 |
| 命中但确认是样例                                 | 按上面「准入标准」在 `.gitleaks.toml` 加**锚定字面量**的豁免，并在 `description` 里说明它从哪来               |
| 命中且是真凭据                                   | 先**轮换**（撤销/重发），再用 `git filter-repo` 清历史；仅删文件不解决问题（历史里还在）                      |

## 本地自查清单

```bash
npm run secret:scan                       # 全历史（默认）
npm run secret:scan -- --json             # 机器可读结果
npm run secret:scan -- --download-only    # 只取二进制（+校验）
node scripts/verify-local.mjs --only secret-scan   # CI 等价入口
```

→ [索引.md](../索引.md) ｜ [构建与测试](../开发指南/构建与测试.md) ｜ [npm audit 静默失效](npm-audit在镜像源下静默失效.md)
