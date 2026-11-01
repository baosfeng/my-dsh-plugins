# 发版前验证清单 — dsh-my-guardian@0.4.9

- 本次发版内容：
  1. **#505 依赖预检识别 npm 全局 dsh web 宿主安装目录**：host-inventory 第四级探测（`argv[1]` / `execPath` 向上找 `@deepseek-ai/dsh` 包根，或 `DSH_HOST_ROOT` 直指）；安装目录清单只认 `@deepseek-ai/*`；缺失项带 `missingHostNamespace` 标注，文案与判定同源
  2. 宿主事件 fixture 重新取证到 **0.2.1-rc.5**（事件清单 44 → 44，无增删）
  3. #508 桌面 App 形态宿主清单按命名空间过滤（与第四级口径统一）
- 验证环境：`DSH_HOME=/tmp/dsh-verify-g409`，profile `g409`（由 shipped `web` 模板派生），端口 3109；宿主 `dsh --version` = **0.2.1-rc.5**
- 安装方式：`npm pack` → `dsh plugin --profile g409 add <tarball>`（与市场用户同一链路，未 link 源码；`dsh-shared@0.1.7` 自动补齐）
- 验证主体：agent（发版前取证，属 server 侧 CLI 行为，非浏览器走查）

## 已验证（可复现判据）

- [x] **安装 + 冷启动**：tarball 326,849 B / 24 files，安装 exit 0；冷启动日志仅 1 行 `dsh web: http://127.0.0.1:3109/?token=…`，`failed to import|Cannot find module|ERR_` 零命中；`/guardian/api/state` 带 token 200、根路径无 token 401
- [x] **第四级探测（npm 全局形态）**：构造 `<prefix>/lib/node_modules/@deepseek-ai/dsh` 布局 → `loadHostInventory()` 返回 `{available:true, source:…/@deepseek-ai/dsh/node_modules, dshLlm:true}`；只给 `argv[1]` 种子（不给 env）同样命中
- [x] **判定层同源**：该场景下 peer `@deepseek-ai/dsh-llm` 的探针行从 issues 中消失（issueCount 4 → 3）
- [x] **命名空间口径**：同一 DSH_HOST_ROOT 场景 `dshLlm:true / yaml:false / ws:false / zod:false`（yaml/ws/zod 实体确实在宿主树里）；判定层 `yaml` 仍判 `dependency-missing`、hint = `dsh plugin add yaml`
- [x] **文案与判定同源（运行期）**：`startup-issues.json` 里 `@deepseek-ai/nonexistent-xyz-probe` → `dependency-missing`、**hint=null**、文案「属 DSH 宿主包，但未在宿主安装目录 / 宿主清单中找到…」；`left-pad-xyz-nonexistent` → hint=`dsh plugin add left-pad-xyz-nonexistent`。运行期已无「由宿主供给、无需安装」文案
- [x] **宿主事件**：`node scripts/host-events.mjs` → reference 0.2.1-rc.2 106 事件 / installed 0.2.1-rc.5 44 事件，升级打穿列表为空
- [x] **收尾**：实例停止、端口 3109 释放、`/tmp/dsh-verify-g409` 与 tarball 删除、`pgrep` 无残留

## 未验证项（如实记录）

- [ ] 浏览器功能级走查（guardian 面板页签、事件流、设置页）——本次改动只在 server 侧，client 产物未变
- [ ] **真实 npm 全局 `dsh web` 安装**：本机无此形态，第四级探测靠构造布局 + `argv[1]` 种子间接验证
- [ ] 桌面 App 运行期 inventory 的实际来源未能在进程内直接观测（无 diagnostic 字段暴露）
- [ ] Windows / Linux 形态；真实模型 / 网关出站路径

## 已知遗留（已登记，不在本次范围）

- #508 的修复覆盖桌面形态命名空间口径；修复后若仍有形态差异，另行登记。
