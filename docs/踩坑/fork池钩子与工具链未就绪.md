# 踩坑：fork 池里 pre-commit / pre-push 从未生效（钩子未挂载 + 工具链未就绪）

> issue #240。**每一个子 agent 都会踩**，而且症状是"看起来没问题"——直到 CI 红盘。
> 同源的独立发现还有 PR #239（另一个 agent 从 prettier 红盘反推出来的）。

## 症状

| 现象                                                 | 真实含义                                            |
| ---------------------------------------------------- | --------------------------------------------------- |
| `git commit` 只花几十毫秒，没有任何 lint-staged 输出 | pre-commit **没跑**，代码没被格式化/检查            |
| 提交进仓库的文件格式不合 prettier，本地"一切正常"    | 同上；CI `quality / Format check (prettier)` 才会红 |
| `git push` 秒回，没有任何 `[verify]` 输出            | pre-push **没跑**，`verify-local` 从未执行          |
| `verify-local` 报 `npx` 找不到 vitest / depcruise    | fork 的 `node_modules/.bin` 不完整（见下文第二节）  |

**代价**：PR #239 因 prettier 红盘、PR #241 因 knip 红盘，**两次都是本地没挡住、CI 才发现**。
一次事故 = 一轮 CI 白跑约 80s + 人工翻日志定位 + 修复重推 + 再等一轮 CI。

## 一、钩子未挂载

### 为什么主工作区没事、只有 fork 有事（最容易误判的点）

在主工作区里钩子一直是好的，于是很容易认定"钩子机制没问题"。实际上 fork 与主工作区有**三处结构性差异**，
每一处都足以让钩子失效：

| 差异             | 主工作区                                           | fork（`git clone --local`）                                           |
| ---------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `core.hooksPath` | `.husky/_`（**local config**，写在 `.git/config`） | **未设置** —— clone 只复制 refs 与对象库，**不复制 `.git/config`**    |
| `.husky/_` 目录  | husky 生成过，存在                                 | **不存在** —— 该目录被自身的 `.gitignore`（内容 `*`）挡住，不进版本库 |
| `prepare: husky` | `npm install` 时执行过                             | **从未执行** —— fork 的 node_modules 是软链，没跑过 `npm install`     |

一句话：**钩子的挂载信息一半在 git 的 local config 里、一半在被 gitignore 的 husky 内部目录里，
两者都不随 `clone` 传递。**

### 判定（三条命令，10 秒出结论）

```bash
git -C /tmp/gh-fork-<编号> config --get core.hooksPath   # 期望 .husky/_；空 = 没挂
ls -A /tmp/gh-fork-<编号>/.husky                          # 只有 commit-msg/pre-commit/pre-push，没有 _ = 没装
cd /tmp/gh-fork-<编号> && node scripts/fork-pool.mjs check --static   # 一条命令给四个 yes/no
```

### 端到端复现（谁都能验）

```bash
# 写一个故意不合 prettier 格式的文件
printf 'export const X={a:1,b:2}\n' > /tmp/gh-fork-<编号>/probe.mjs
git -C /tmp/gh-fork-<编号> add probe.mjs && git -C /tmp/gh-fork-<编号> commit -m "test: probe"
git -C /tmp/gh-fork-<编号> show HEAD:probe.mjs
# 未装钩子 → 原样 `export const X={a:1,b:2}`（36ms 提交完）
# 装好钩子 → `export const X = { a: 1, b: 2 }`（约 800ms，lint-staged 自动 --write 并重新 stage）
```

### 修法

**主路径（推荐）**：用脚本建 fork，它默认把钩子装好。

```bash
node scripts/fork-pool.mjs create <编号>       # 含"安装 git hooks"一步，约 73ms
```

**手工兜底（脚本不可用时）**：

```bash
cd /tmp/gh-fork-<编号>
./node_modules/.bin/husky                      # 生成 .husky/_ 并设置 core.hooksPath
git config --get core.hooksPath                # 判据：输出 .husky/_
```

> 修好之后的代价：commit 从 36ms 变成约 800ms、push 增加 0.5s（纯文档）到 23.6s（安全退化全量）。
> 这个代价是**必须付的**——一次漏检事故约 460s，够付约 570 次提交（见
> [工程效率规范](../开发指南/工程效率规范.md)第六节）。

## 二、工具链未就绪：`.bin` 被 shell glob 漏掉

### 症状

`verify-local` 里若干检查项报错：

    npm error npx canceled due to missing packages and no YES option: ["depcruise@1.0.0"]
    Cannot find package '@vitest/coverage-v8' imported from /Users/.../node_modules/vitest/...

极易被误读成"我的代码有问题"，于是掉头去改本来就正确的代码。

### 根因（一个字符级的坑）

用 shell 循环给 fork 建 node_modules 软链时：

```bash
for d in "$MAIN"/node_modules/*; do ln -s "$d" ...; done   # ❌ glob 默认不匹配点号开头的名字
```

**`.bin` 是隐藏目录**，`*` 不匹配它 —— 顺带漏掉的还有 `.cache`、`.vite`、`.package-lock.json`（实测隐藏条目 0 个）。
没有 `.bin` → `npx <tool>` 在本地找不到 → 退回远程下载（无网络 / 无 YES）或直接 `command not found`。

| 建法                        | 隐藏条目            | `npx --no-install vitest --version` |
| --------------------------- | ------------------- | ----------------------------------- |
| shell `node_modules/*` 循环 | 0 个（`.bin` 全漏） | 失败                                |
| Node `readdirSync`          | 8 个全含 `.bin`     | exit 0                              |
| 整目录软链                  | 天然完整            | exit 0                              |

### 修法

用 `scripts/fork-pool.mjs create`（内部用 `fs.readdirSync`，天然包含隐藏条目），或手工用 Node 建：

```bash
node -e "const{readdirSync,symlinkSync,mkdirSync}=require('node:fs');const{join}=require('node:path');
const m='<主工作区>/node_modules',t='/tmp/gh-fork-<编号>/node_modules';mkdirSync(t,{recursive:true});
for(const e of readdirSync(m)){try{symlinkSync(join(m,e),join(t,e))}catch{}}"
```

判据：`node scripts/fork-pool.mjs check --static` 的「工具链可解析」一项为 ✔。

## 三、连带坑：把 `.husky/` 里的命令简化成变量会撞上 knip

优化 hook 时把 `npx --no-install lint-staged` 改成变量 `$LINT_STAGED_CMD`，**knip 立刻报**：

    Unused devDependencies (1)
    lint-staged  package.json:64:6

→ CI 的 `Dead code check (knip)` 直接红。

**根因**（`node_modules/knip/dist/plugins/husky/index.js`）：knip 的 husky 插件会读取 `.husky/` 下每个 hook 的
**脚本文本**，从中提取 known bins，据此判定 devDependencies 是否真被使用。命令变成变量后，它提取不到 `lint-staged`。

**修法**：fallback 分支里的 `npx --no-install lint-staged` 必须保持为**真实执行的命令**：

```sh
if [ -x "$BIN_DIR/lint-staged" ]; then
  ( "$BIN_DIR/lint-staged"; ... )      # 直调，省约 174ms
else
  ( npx --no-install lint-staged; ... ) # ← 这行不能简化成变量
fi
```

判据：`./node_modules/.bin/knip` exit 0。

## 相关

- [工程效率规范](../开发指南/工程效率规范.md) —— 第六节（优化不许削弱门禁）与第七节（验证链路可信性）
- [fork 池基线与 squash 判定](fork池基线与squash判定.md)
- [多 agent 并行测试资源冲突](多agent并行测试资源冲突.md)
