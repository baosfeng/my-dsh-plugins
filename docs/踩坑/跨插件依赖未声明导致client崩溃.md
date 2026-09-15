---
title: 跨插件依赖未声明导致 client 崩溃
description: client 端 require('dsh-*') / dsh.client.external 未声明或只声明 peerDependencies 导致插件加载崩溃（issue #39 / #290 / #293 实例），以及"缺包场景假通过"的门禁教训（issue #294）
created: 2026-08-28
status: 已解决
---

# 跨插件依赖未声明导致 client 崩溃

## 现象

用户环境报错：`dsh-think-zh-expand` v0.4.3 的 client 端 `require('dsh-md-render')` 失败，插件加载崩溃。

## 根因

1. **跨插件依赖未声明**：client 端 `require('dsh-md-render').MarkdownView`，但 package.json `peerDependencies` 没有声明 `dsh-md-render`（只有 `dsh.client.external` 构建配置，没有 npm 分发层面的依赖声明）；
2. **依赖包从未发布**：`dsh-md-render` v0.1.1 当时既无 GitHub Release 也不在 npm 上；
3. **发版流程未校验跨插件依赖**：`release.mjs` 校验了 CHANGELOG/测试/截图/版本，但没有校验 client 端 require 的包是否已声明、已发布；
4. **发版前未强制真实环境验证**：`verifying-dsh-plugins` 流程没有强制执行，发版前未发现崩溃。

## 解决方案（issue #39）

1. **修复声明**：`dsh-think-zh-expand/package.json` 的 `peerDependencies` 补声明 `"dsh-md-render": "^0.1.1"`；
2. **发版流程强制校验**（`scripts/release.mjs` 步骤 1c，纯函数在 `scripts/lib/release-checks.mjs`）：
   - 扫描 client/server 端源码 `require('dsh-*')` / `import` 的包 → 必须在 `peerDependencies` 或 `dependencies` 声明（issue #72：扫描范围从 client 端扩展到 server 端——dsh-shared 是 server 端运行时 import 的，原先漏检）；
   - 声明的仓库内 dsh-* 依赖必须已发布（`npm view`）且已打 tag（`<目录>@v<版本>`）——**依赖先发版、依赖方后发版**；npm view 返回 404（从未发布）直接阻断，不再被「已打 tag」兜底放行（issue #72）；
3. **真实环境验证强制**（`scripts/release.mjs` 步骤 3c）：发版前自动跑 `verify-real-profile.mjs --addons plugins/<名>`，失败即阻断；CI 无生产 profile 自动跳过，本地 `--skip-real-verify` 显式跳过。

## 防复发

- 发版校验单测：`npm run test:scripts`（`scripts/test/release-checks.test.mjs`，CI quality job 强制）；
- 任何新增 `require('dsh-*')` 的插件，发版时会被步骤 1c 拦截（未声明即失败）。

## 配套修复（发版强制真实环境验证暴露）

`release.mjs` 强制真实环境验证后，`verify-real-profile.mjs` 对**已安装插件**跑 `--addons` 暴露两个既有问题（均已修复）：

1. **addons 软链 EEXIST**：生产 profile 已 `link:` 安装的插件在 node_modules 已有同名条目，addons 软链冲突 → 已存在则复用（指向真实源码，效果相同）；
2. **模拟安装制造重复 id**：已手动安装的插件（cordis.patch.yml 有手动行）被再次写入 bundles → bundle 自动插行 + patch 手动行叠加产生 `duplicate loader entry id` → 模拟安装前检查插件是否已在生产配置（bundles 或 patch 行），已存在则不重复写入。

→ [踩坑记录](README.md)

## 复发与升级（issue #290 / #293 / #294）：声明对了，用户还是崩

#39 的修复只解决了「没声明」。**#290（`dsh-think-zh-expand@0.4.8` 新装必崩）证明声明对了照样崩**，
#293 又证明「try/catch 降级」也是假的。三个坑逐层剥开：

1. **`dsh.client.external` 的真实语义**：它是「**同 boot 图内的跨插件 client 行请求**」。
   只有被请求的包成为 loader entry（⇒ 进入 `dsh.profile.bundles`）才会产生 client graph row，
   浏览器端 `require` 才命中（`dsh-client-modules/lib/client.js` 的 `makeRequire` 只认
   seed / 已 materialize 行 / 已注册 factory）。缺包时**无 stub、无隔离**：整条 client factory 抛错，
   插件**全部 UI 席位**一起挂。
2. **`peerDependencies` 兜不住**：`dsh plugin add` 只是 pnpm 转发器，装完由 `reconcilePlugins` 把
   **profile `dependencies`** 里声明了 `dsh.bundle.patch` 的包写进 `dsh.profile.bundles`；
   而 profile 模板是 `autoInstallPeers: false` —— peer **永不安装**。
   所以「external 依赖只写在 peerDependencies」= 新装用户必然拿不到 ⇒ 必崩。
3. **假降级**：只 catch `require` 不够。缺包时 `MarkdownView` 为 `null`，渲染期
   `createElement(null)` 仍抛 `Element type is invalid`。降级必须**换成平台 seed 组件或纯文本回退**，
   而不是把 `null` 传进渲染树。

**正确修法**（两条路径，任选其一；门禁按"是否真的能降级"判，不按"声明写在哪个字段"判）：

- ① **（推荐）显式降级声明**：按 #293 的形态补**真实降级路径**（平台 seed 组件或纯文本回退，
  绝不让渲染期 `createElement(null)` 抛错），并在 `package.json` 声明：
  ```json
  "dsh": { "client": { "external": ["dsh-md-render"], "externalDegraded": ["dsh-md-render"] } }
  ```
  语义 = "这个 external 缺失时有降级路径（仍可用，只是能力降级）"。宿主解析 `dsh.client`
  只认 `platform` / `inject` / `external` / `immediately`，**未知字段一律丢弃** → 该字段对
  宿主与运行时完全安全（纯门禁/契约元数据，不改变任何加载行为）。
- ② **移进 `dependencies` 并且保证安装流程同时激活该插件**：注意单独移进 deps **不够**
  （论证见下节），必须真的进 `dsh.profile.bundles`（例如依赖包自身声明 `dsh.bundle.patch`
  且被 profile **直接**依赖）。

## 为什么门禁不要求"把依赖移进 dependencies"（关键论证）

一开始的规则是"external 指向仓库内插件时必须在 `dependencies`"，这是**错的**：它要求在
本架构下**没有实际作用**的东西，还会阻断自己人（`dsh-think-zh-expand` / `dsh-my-plugin-manager`）。

- `dsh plugin add <pkg>` 只是 pnpm 转发器；装完由 `reconcilePlugins` 把 **profile 直接
  `dependencies`** 里声明了 `dsh.bundle.patch` 的包写进 `dsh.profile.bundles`；
- 插件**自己的** dependency 只被 pnpm 铺到 `profile/node_modules`（hoisted）——
  **不会**进 profile 的 dependencies、**不会**被 reconcile 激活；
- 没有 loader entry ⇒ 没有 client graph row ⇒ 浏览器端 `require` 依旧落空 ⇒ 与 peer-only
  **行为完全相同**（`peerDependencies` 在 profile 模板 `autoInstallPeers: false` 下更是永不安装）。

也就是说"移进 dependencies"只保证包落盘，属**形式合规**；用形式合规换门禁放行，就抓不到
#290/#293 这类崩溃。故门禁认的是**显式降级声明**（`externalDegraded`，可被 3c 缺包演练
客观检验）+ `dependencies` 场景下的「已发布 + 已打 tag」。该字段语义开放，给未来其它
降级形态留了口（不必改门禁）。

## 门禁两个缺口（issue #294 补齐）

| 缺口                          | 表现                                                                                                                               | 修法                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1c 不读 `dsh.client.external` | 全仓 `grep external scripts/*.mjs` 只命中 ship 的"外发"语义，external 零校验                                                       | `release-checks.mjs` 新增 `checkClientExternals`：① external 每项必须在 deps/peers 声明；② 仓库内包在 `dependencies` → 走「已发布 + 已打 tag」（复用 `findUnpublishedDeps`），**仅**在 `peerDependencies` → 必须显式声明 `dsh.client.externalDegraded`（缺失时有降级路径），否则阻断；冗余声明只 info 不阻断；`release.mjs` 1c 用 `gateFail('1c', …)` 登记；修法文案给出上述两条路径并指向本文档。**判据不认"移进 dependencies"**——理由见上一节                                    |
| 3c 结构性假通过               | 隔离实例**无条件复用**生产 profile 的全部 node_modules；本机 profile 已装 `dsh-md-render` ⇒ 「新装用户没装它」这个状态永远验证不到 | `verify-real-profile.mjs` 新增 `--clean-externals`（从 `--addons` 的 `dsh.client.external` 推导缺失集合）与 `--omit-node-modules <pkg>`：节点既不复用真实 profile、也不做 addon 链接，**并且**从隔离 profile 配置（`dependencies` + `dsh.profile.bundles`）里剔除；启动前 `checkOmittedAbsent` fail-closed 校验"确实不可解析"；日志错误扫描补 `failed to import loader entry` / `missed the module table` / `Element type is invalid` / `Cannot find module`。发版门禁 3c 默认开启 |

## 两个"验证本身不可信"的坑（#294 实测踩到，防复发）

1. **只删 node_modules 会得到不一致状态**：配置里还列着该 bundle ⇒ DSH 在 dump-config/boot 阶段
   直接抛 `cannot resolve profile bundle "dsh-md-render" from the dsh installation or <profileDir>`，
   实例根本起不来 —— 反而验不到「缺包时插件能否降级」。必须连 `dependencies` + `dsh.profile.bundles`
   一起剔除（`stripProfileDeclarations`），才是"这个包从来没装过"的真实形态。
2. **残留实例 ⇒ 0.2s 假就绪**：就绪探测只认「任何 HTTP 响应」，上一轮遗留的隔离实例占着同一端口时，
   本轮在自己实例还没起来（甚至起不来）时就判"HTTP 200 就绪"（实测 0.2s vs 真实冷启动 ~8s）。
   现在启动前 `isPortInUse` **fail-closed**：端口被占直接报错，绝不把他人实例当成自己的验证结果。

> 边界（诚实记录）：client 侧崩溃（`Element type is invalid`）发生在**浏览器运行时**，
> server 启动日志未必留痕。3c 的缺包演练能保证「实例能起、加载无错」，但
> 「缺包时 UI 是否真的降级渲染」仍需 `skills/verifying-dsh-plugins` 的浏览器步骤确认 ——
> 不要把 3c 的绿当成这一项已验证。

→ [踩坑记录](README.md)
