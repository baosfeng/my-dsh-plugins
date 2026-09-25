# 发版前功能级验证清单 — dsh-plugin-dev-mode@0.2.0

验证时间：2026-09-25（宿主 0.1.7-rc.2 与 0.1.5-rc.1 双版本对照）
验证环境：**两份独立 DSH_HOME + 干净派生 profile**（非生产 profile 复刻，理由见下）；真实浏览器（agent-browser 0.34.0）

> 验证方式说明：本包是 **agent preset 声明包**（`dsh.kind=preset`，包内只有 YAML 与文档、无 JS、无 client），
> `release.mjs` 按形态**豁免 3c 的 profile 组合验证**（`--addons` 的 bundle 组合检查不适用，且声明行需要宿主
> ≥ 0.1.7-rc.2 才能激活）。故本清单由验证者**手写**，按 preset 自身的安装方式（`dsh plugin add` 装 bundle →
> `--dump-config` 看声明行 → 真实 GUI 看 preset 花名册）逐项取证。

## 自动验证项（形态豁免：release.mjs 1b-pre / 3c）

- [x] 形态判定（`dsh.kind=preset` + `dsh.bundle.patch` + 非空 `dsh.presetReason`，`lib/preset-gate.mjs`）
- [x] 3c profile 组合验证：按形态豁免（preset 声明包无 `peerDependencies.cordis`、无 client bundle）
- [x] 插件测试（`npm test`）
- [x] 包发布卫生（pack 内容 + 字段断言 + README 引用面）

## 功能级验证项（验证者勾选）

- [x] preset 声明行随 bundle 装载成功（0.1.7-rc.2：`--dump-config` 出现 `preset-plugin-dev` 行）
- [x] preset 出现在真实 GUI 的 agent preset 花名册（浏览器实测：「插件开发模式」）
- [x] preset 可被真实选中绑定（GUI 选中后合成器模式按钮变为「插件开发模式」）
- [x] 旧宿主对照（0.1.5-rc.1：preset 不出现且 profile 启动失败）
- [x] 验证后环境已清理（两套实例停止 / 临时 DSH_HOME 删除 / 端口释放）

## 验证记录

命令与输出（关键片段）：

1. **0.1.7-rc.2（目标宿主，`/tmp/dsh-host-017`，非全局安装）**，`DSH_HOME=/tmp/dsh-preset-017`：
   - `dsh --profile preset-verify --from-default-profile web --dump-config` → exit 0
   - `dsh plugin --profile preset-verify add link:<repo>/plugins/dsh-plugin-dev-mode` → `+ dsh-plugin-dev-mode link:…`（pnpm 283ms）
   - `--dump-config` 中出现声明行：
     `# == dsh-plugin-dev-mode` / `- id: preset-plugin-dev` / `name: '@deepseek-ai/dsh-agent-preset'` / `config.id: plugin-dev` / `name: 插件开发模式`
   - 错误扫描（`failed to apply|without inject|missed the module table|plugin tree failed`）零命中
2. **真实 GUI**（`dsh --profile preset-verify --port 3097`，浏览器带 token 打开）：点开合成器模式选择器，花名册列出
   「标准模式 / PTC 模式 / 极简模式 / 创造模式 / **插件开发模式**」，其中「插件开发模式」的说明文案与
   `cordis.patch.yml` 的 `config.description` 逐字一致；点选后按钮变为「插件开发模式」（绑定成功）。截图 `/tmp/verify-preset-017.png`。
3. **对照 0.1.5-rc.1（本机全局宿主，`DSH_HOME=/tmp/dsh-preset-015`）**：同一 bundle 装进派生 profile 后启动失败：
   `Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to import loader entry preset-plugin-dev (@deepseek-ai/dsh-agent-preset): Cannot find package '@deepseek-ai/dsh-agent-preset' imported from /tmp/dsh-preset-015/profiles/preset-verify/`（`ERR_MODULE_NOT_FOUND`，进程存活但端口不监听）。
   宿主包表对照：0.1.5-rc.1 只有 `@deepseek-ai/dsh-agent-presets`（旧目录机制），0.1.7-rc.2 为 `@deepseek-ai/dsh-agent-preset` + `@deepseek-ai/dsh-agent-preset-registry`。
4. **未覆盖 / 局限**：未跑真实模型会话（preset 的 persona/工具清单生效属模型可见面，本轮变更的判据是「声明行装载 + 注册进花名册 + 可绑定」）；未做 preset 内插件逐个冒烟（由声明行引用的宿主官方包提供）。
5. **清理**：3096 / 3097 实例已停止、`/tmp/dsh-preset-017` 与 `/tmp/dsh-preset-015` 已删除、端口已释放。
