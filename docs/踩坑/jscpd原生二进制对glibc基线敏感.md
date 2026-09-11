---
title: jscpd 原生二进制对 glibc 基线敏感
description: jscpd 5.x 的 Rust 自包含二进制要求 GLIBC ≥ 2.33，旧 glibc 容器直接加载失败 → 门禁项恒红且无任何输出；改为锁 4.x 纯 JS 版
created: 2026-09-11
updated: 2026-09-11
---

# jscpd 原生二进制对 glibc 基线敏感

## 现象

CI 一轮 12 项门禁里**只有**「10/12 重复代码 jscpd」失败，日志原文：

```
──── 10/12 重复代码 jscpd ────
.../node_modules/jscpd-linux-x64-gnu/bin/jscpd: /lib64/libc.so.6:
  version `GLIBC_2.33' not found (required by .../node_modules/jscpd-linux-x64-gnu/bin/jscpd)
.../node_modules/jscpd-linux-x64-gnu/bin/jscpd: /lib64/libc.so.6:
  version `GLIBC_2.34' not found (required by .../node_modules/jscpd-linux-x64-gnu/bin/jscpd)
❌ 10/12 重复代码 jscpd
```

**关键识别点**：这一段**没有任何重复代码（clone/Repeat）清单**——说明二进制根本没启动，失败发生在 loader 阶段，与仓库代码、重复率毫无关系。

## 根因

jscpd 5.x 是 **Rust 自包含二进制**（`node_modules/jscpd/package.json` 的 description 原文即 "Rust engine, self-contained binary"），平台产物通过可选依赖分发（`jscpd-linux-x64-gnu` 等）。该 gnu 产物在 GitHub `ubuntu-latest`（glibc 2.35+）上构建，引用了高版本 glibc 的版本化符号：

```bash
# 取证（无需 Linux 机器）
cd /tmp && npm pack jscpd-linux-x64-gnu@5.1.2 --registry=https://registry.npmmirror.com
tar xzf jscpd-linux-x64-gnu-5.1.2.tgz
strings package/bin/jscpd | grep -o 'GLIBC_2\.[0-9]*' | sort -uV | tail -8
# → GLIBC_2.30 / 2.32 / 2.33 / 2.34
```

而那次失败跑在 **glibc = 2.32** 的旧基线容器里（已废弃的容器化流水线通道）→ loader 直接拒绝加载。

**自洽反证**：报错只抱怨缺 `2.33` 和 `2.34`（更低的 2.18/2.25/2.28/2.29/2.30/2.32 全部满足）→ 容器 glibc 恰好是 **2.32**，与旧基线的已知版本一致，无需进容器实测。

## 被排除的误判：不是 YAML 重复块

同一轮 CI 里刚加入了逐字重复的流水线 job 脚本块，很容易被误判为"重复代码超标导致 jscpd 拦下"。**实测证伪**：

```bash
npx jscpd --debug 2>&1 | grep -c 'workflow'   # → 0：扫描集里没有流水线 YAML
```

`.jscpd.json` 用 `format: ["javascript", "typescript"]` 白名单，**任何 YAML 都不在扫描范围内**；本地 `npx jscpd` 实测 exit 0（3 clones / 0.10%，threshold 5%）。判据：**先看门禁有没有产出它本该产出的清单/报告**——只有 loader/启动错误、没有清单，就是工具本身没跑起来，而不是它判定超标。

## 修法

按"**门禁可靠性 > 原始性能**"取舍，锁 `jscpd@4.3.0`（纯 JS 实现）：

- **零原生依赖**：`optionalDependencies` 为空，`bin/jscpd` 是 `#!/usr/bin/env node` 脚本 → 与容器 glibc 基线无关，本地（macOS）与 Linux CI **同源可验证**。
- **配置语义不变**：`minTokens` / `minLines` / `format` / `ignore` / `threshold` 4.x 全支持；实测 `ignore` 的 `**/test/**`、`**/scripts/**`、`**/lib/client.js` 依然生效（`--debug` 逐条核对）。
- **代价**：扫描耗时从 5.x 的 ~50ms 变为 ~2.7s（本仓库 300+ 文件），对本仓库不是瓶颈。

被否掉的两条路（各有硬伤，记录备查）：

- **换 job 镜像**到 glibc ≥ 2.34：平台侧"正解"，但要重验镜像内 Node/Python 链路（不同发行版的包管理器与依赖基线都不同），为一个工具推翻整条链路不划算。
- **保留 5.x + 装 `jscpd-linux-x64-musl` 静态包**：jscpd 的 launcher（`platform-map.js`）按**运行时 libc** 硬选 gnu 包、无环境变量可覆盖，必须绕过 launcher 直接调二进制；且 macOS 上无法本地验证，"可本地验证"这条会丢掉。

**回退条件**：若将来 CI 的 glibc 基线 ≥ 2.34（`ubuntu-22.04`+ runner、基于 Debian bookworm 的官方 `node` 基础镜像等），可升回 `jscpd@5.x` 并删掉这条记录。

## 原则

- 依赖**预编译二进制**的门禁工具（jscpd 5、esbuild 系、各语言 binding），必须核对**目标容器/runner** 的 glibc 基线；"本机能跑"完全不构成证据。
- CI 运行环境一旦确定，对所有原生依赖都是一条隐形约束线；把结论与回退条件写进文档，别只留在某次 CI 日志里。
- 门禁失败先分类：**"工具没跑起来"（loader/ENOENT/权限）vs "工具跑出了结论且超标"**。前者与代码无关，改代码/改流水线都是无效功（本次差点据此做了一轮无用的 YAML 重构）。

## 相关

- `package.json`（`jscpd` 依赖版本锁定处）
- `docs/踩坑/CI容器以root运行导致权限位断言失效.md`（同一轮 CI 的另一个失败：测试对执行环境的脆弱假设）
