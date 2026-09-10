---
title: CI 容器以 root 运行导致权限位断言失效
description: chmod 0555 注入写失败在 root/CAP_DAC_OVERRIDE 下无效，测试假失败；给出 ACL 等价复现手法与两种修法
created: 2026-09-10
updated: 2026-09-10
---

# CI 容器以 root 运行导致权限位断言失效

## 现象

云效 CI 容器以 **root** 运行（工作目录 `/root/workspace/...`，具备 `CAP_DAC_OVERRIDE`），`plugins/dsh-my-observability` 的"只读目录写失败降级"用例失败，同一份测试在 GitHub Actions（非 root runner 用户）下通过：

```
FAIL test/host-store-persist.mjs > persist io 错误降级：只读目录不致崩溃且告警
AssertionError: snapshot/append failures logged (got 0)
  at test/host-store-persist.mjs:141
```

**根因不是实现 bug**：用例用 `chmodSync(dir, 0o555)` 把目录设为只读，期望写入抛 EACCES 触发降级告警；但 root 无视文件 mode 位（`CAP_DAC_OVERRIDE`），写入照样成功 → 两个函数都不进 catch → 捕获到的 warn 数为 0 → 断言失败。这是**测试对执行环境（运行用户特权等级）的脆弱假设**。

同一模式在 `plugins/dsh-shared/test/jsonl.mjs`（`chmodSync(dir, 0o555)` + `warns.length >= 2`）也存在，云效若遍历全部插件会同样变红（已一并修复）。

## 本机等价复现（macOS，无需 docker / sudo）

root 的本质是"**mode 位不再决定能否写入**"。macOS 的 **ACL** 具有完全相同的效果：给目录加一条 `allow write` ACL 后，即使 mode 是 `0555`，写入依然成功——而且 **`chmod 0555` 不会清除已有的 ACL**（关键，实测确认）：

```bash
d=$(mktemp -d); mkdir -p "$d/observability"
chmod +a "user:$(id -un) allow write,add_file,add_subdirectory,delete_child" "$d/observability"
chmod 0555 "$d/observability"
stat -f '%Sp' "$d/observability"          # dr-xr-xr-x（权限位看起来是只读）
touch "$d/observability/probe" && echo "写入成功 ⇒ 权限位已失效（等价 root）"
```

要做**环境级**复现（不改测试代码，让测试自己 `mkdtempSync` 出来的目录也中招），用 ACL 继承 + `TMPDIR`（Node 的 `os.tmpdir()` 读 `TMPDIR`）：

```bash
me=$(id -un); base=$(mktemp -d)
chmod +a "user:$me allow write,add_file,add_subdirectory,delete_child,file_inherit,directory_inherit" "$base"
TMPDIR="$base" npx vitest run test/host-store-persist.mjs   # 新建的临时 home 全部继承 ACL
chmod -N "$base"; rm -rf "$base"                            # 用完清 ACL 再删
```

实测（原封不动的修复前测试）：

```
× persist io 错误降级：只读目录不致崩溃且告警
AssertionError: snapshot/append failures logged (got 0)    ← 与云效报错逐字一致
Tests  1 failed | 7 passed (8)
```

Linux 上（云效/CI 同类环境）没有这个 ACL 语义，直接用容器复现更省事：
`docker run --rm -u root -v "$PWD":/w -w /w node:22 bash -lc 'cd plugins/dsh-my-observability && npm test'`。

## 修法（两种，本项目两种都用）

**A. 让失败注入不依赖权限位（首选，主用例）**——构造**确定性 I/O 错误**，POSIX 语义与运行用户无关：

| 注入               | 触发点                                                                      | 错误码    |
| ------------------ | --------------------------------------------------------------------------- | --------- |
| 目标路径本身是目录 | `writeSnapshot` 的 `rename(tmp, file)`、`appendLines` 的 `appendFile(file)` | `EISDIR`  |
| 父层级是常规文件   | 两者的 `mkdir(dir, { recursive: true })`                                    | `ENOTDIR` |

仍是真实 fs 错误（不是 mock），覆盖的仍是"落盘失败 → 只告警不抛出"这条逻辑，且断言可以**加强**：校验 warn 条数精确值、`prefix`、以及 `snapshot failed` / `append failed` 来源区分。

**B. 保留只读目录（EACCES）用例 + 动态探测特权环境（补充用例）**——不生效时 `context.skip(reason)` 并 `console.log` 打印原因：

```js
function permBitsEnforced(dir) {
  // 真正探测能力，而非猜 uid
  chmodSync(dir, 0o555)
  try {
    writeFileSync(join(dir, '.perm-probe'), '', 'utf8')
    return false
  } catch {
    // 写成功 ⇒ 权限位不生效
    return true
  } finally {
    rmSync(join(dir, '.perm-probe'), { force: true })
    chmodSync(dir, 0o755)
  }
}
```

比 `process.getuid?.() === 0` 更准：Windows、只读挂载、容器/网络文件系统、ACL 等"mode 位不生效"的情形都能识别，且不依赖 `getuid` 存在。非特权环境下该用例的原始断言与强度**完全不变**（真实验证 EACCES → 告警）。

**取舍**：A 是唯一在特权环境下仍具判定力的写法，故作为主用例；B 保留真实 EACCES 场景，代价是特权环境下该场景**无法被覆盖**（root 下写入不会失败）——损失的只是"EACCES 这一具体错误来源"，同一段 `catch`/`warn` 代码由 A 覆盖。**不要**把整条覆盖删成空断言，也不要只用 B 而不补 A。

## 原则

- **权限位、文件属主、特权等级不是测试可以依赖的前置条件**；断言结果不应随执行用户变化。
- **CI（root）与非特权本地都必须全绿**；只在本机过、只在 CI 过，都算未完成。
- 凡是"制造失败"的测试，优先问一句：**这个失败在 root 下还会失败吗？** 靠权限位/只读挂载/属主的失败注入，一律按上面的 A（或 A+B）处理。
- 同类排查模式：`chmodSync(..., 0o555|0o444|0o000)` + 期望失败、`chmod` shell 注入、`process.getuid()` 分支、`statSync().mode` / 属主断言、假定的"不可写路径"。

## 本次修复与扫描结论（2026-09-10）

已修：

- `plugins/dsh-my-observability/test/host-store-persist.mjs` — 主用例改 EISDIR/ENOTDIR 注入（断言 4 条 warn + 来源），只读目录用例加探测 skip。
- `plugins/dsh-shared/test/jsonl.mjs` — 新增 EISDIR/ENOTDIR 主用例（断言 4 条 warn + 来源），原只读目录用例加探测 skip。

扫描为安全（无需改）：

- `.stryker-tmp/` 沙箱里的旧副本：已被 `.gitignore` 忽略，不参与 CI。
- `plugins/dsh-file-activity/test/bash-parse.mjs:114` — 期望值与 `lib/bash-ops.js` 同用 `os.homedir()`，一致。
- `plugins/dsh-file-activity/test/client-render.mjs:361`、`plugins/dsh-my-skill-manager/test/client-render.mjs:299` — 写死的绝对路径只是渲染/mock 输入字符串，不触真实 fs。
- `plugins/dsh-my-plugin-manager/test/host-api.mjs:450` — `'EACCES'` 是 mock 的 stderr 字符串。
- `plugins/dsh-my-guard` 等处的 `.mode` 断言是业务字段（guard 模式），非文件权限。

留清单（低风险，未改，超出本次授权边界）：`plugins/dsh-my-skill-manager/test/diagnose.mjs:127` 用 `process.env.HOME ?? ''` 构造期望，而 `lib/diagnose.js` 在无 `DSH_HOME` 时用 `os.homedir()`；两者仅在 **`HOME` 未设置**时不一致（Node 的 `homedir()` 会回退 getpwuid），常规 CI/本地都会设置 `HOME`，故未触发。

## 相关

- `plugins/dsh-my-observability/test/host-store-persist.mjs`、`plugins/dsh-shared/test/jsonl.mjs`（文件头注释含覆盖边界说明）
- `docs/踩坑/多agent并行测试资源冲突.md`（测试环境类踩坑的同类记录）
