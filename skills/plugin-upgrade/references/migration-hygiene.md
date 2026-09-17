# 迁移卫生 · 与版本无关的工具链坑

> 这五条不属于任何版本走廊，但任何一段迁移都可能被它们耗掉半小时以上。

## 1. tsbuildinfo 增量误报

- 症状：改完源码后，类型检查报出与本次改动无关的旧错误（缺导出一类），或构建报缺导出而 tsc 明明通过；增量检查直接过、真实错误链只在 clean 之后才浮现。
- 修法：迁移验证期间每次构建前先 clean；怀疑缓存误报时先 clean 排除缓存，再定位真实引用。

## 2. oxc / vite 解析比 tsc 严

- 症状：tsc 通过，构建却报解析错误。已知触发：JSX 标签未闭合、多行三元表达式里写箭头函数。
- 修法：按解析器提示改写表达式（预先算成变量、把语句拆开），不要绕过；tsc 通过不等于构建通过。

## 3. 改动生效面：客户端硬刷新 vs 宿主重启

- 症状：改完代码刷新浏览器看不出变化，或宿主仍按旧版本行为运行。
- 修法：先判断改动落在哪半边——客户端产物改动靠浏览器硬刷新生效，宿主侧产物改动必须重启 dsh 进程。

## 4. pnpm 默认拦截依赖构建脚本

- 症状：pnpm ≥10 拒绝运行 git 依赖的 `prepare` / 原生构建脚本，新环境第一次 `dsh plugin add` 直接失败。
- 修法（官方）：把 pnpm 打印的**确切包键**逐个复制进该 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`，再重跑 add：

  ```yaml
  allowBuilds:
    <包键>: true
  ```

- ⚠️ 这项授权等于**允许该包的代码在安装时于你的机器上执行**，且不在 agent 运行的任何沙箱之内——只授权源码可信的包，并用 `#<sha>` 锁定 commit。见官方 [publish.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)。
- **不要用 `pnpm approve-builds --all`**：它一次放开所有包的构建脚本，正是绕过上面这条逐包审查警告的做法。不想让用户授权就改发预构建产物（npm publish 或 `pnpm pack` tarball），两者都不需要构建权限。

## 5. 测试代码里的 readonly / as-in-JSX

- 症状：迁移后源码类型检查全过，测试文件却编译失败。
- 修法：fiber 上像 `dispose` 这类字段变成 readonly、测试不能再直接赋值 mock 时，改成间接观察；测试文件里的 `as` 断言在 JSX 解析路径上不支持，先收窄到变量。

## 验证纪律

每次迁移改动都跑完整链条：clean → build → typecheck → test，然后真实启动（Web 客户端硬刷新；改动落在宿主半边时重启宿主）。只看增量检查的结论不可信——见第 1 条。
