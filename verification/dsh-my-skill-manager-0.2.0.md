# 发版前验证清单 — dsh-my-skill-manager@0.2.0

- 本次发版内容：**界面与实现重写**（按已验收原型），API 形状变更（`/list` 全量 + 双禁用名单 + path/invocation；新增 `/detail`），服务端模块重组。
- 验证环境：隔离 `DSH_HOME`（全新目录，不复制生产配置），profile 由 shipped `web` 模板派生，安装走 `dsh plugin add <tarball>` 同一链路。
- 验证主体：**用户本人**在真实浏览器走查；agent 只提供步骤与机器门禁证据，不代跑。

## 机器门禁（agent 执行，可复现）

- [ ] `cd plugins/dsh-my-skill-manager && npm test`：vitest（含覆盖率阈值）+ cucumber 全绿
- [ ] `npx tsc -p tsconfig.json` 与 `npx tsc --noEmit -p tsconfig.client.json` 无错
- [ ] `node scripts/check-client-size.mjs` 通过（基线已按本次重写刷新）
- [ ] `node scripts/check-ts-size.mjs` 无新增超标
- [ ] `node scripts/check-client-modules.mjs` 通过
- [ ] `npm run verify`（仓库全量，CI 等价）全绿
- [ ] `lib/client.js` 与 `lib/**` 产物已提交、可 `node --check`

## 人工自测（浏览器，逐条勾）

### 安装与启动

- [ ] 纯净 profile 安装 tarball 成功，启动日志无 `failed to import` / `Cannot find module`
- [ ] 设置 → 插件 → **Skill 管理** 页签可见，无白屏
- [ ] 首屏加载出列表（加载骨架 → 数据），计数与实际 skill 数一致

### 命令条与组织

- [ ] 搜索名称/描述/路径即时过滤；⌘K 聚焦、Esc 清空、清除按钮
- [ ] 概览数字（全部/启用/禁用/异常）可点击当筛选
- [ ] 「重新扫描」有 loading，完成后扫描时间更新
- [ ] 来源筛选、状态筛选、「只看未使用」可叠加
- [ ] 排序：名称 / 使用次数 / 最近 / 来源，方向切换正确
- [ ] 卡片流 ↔ 紧凑表切换保留搜索与筛选

### 双作用域与状态

- [ ] 每卡「全局」「本项目」两个开关并排
- [ ] 全局关 → 所有项目不生效；仅本项目关 → 其他作用域仍生效
- [ ] 未收录条目显示「未收录」且开关禁用，说明不注入
- [ ] 作用域状态徽标（生效 / 全局已禁用 / 本项目已禁用）与开关一致

### 详情与预览

- [ ] 点卡片/行展开两列详情：描述全文、路径（可复制）、provider、调用能力徽标、使用统计
- [ ] SKILL.md 预览前 15 行、可展开、可复制全文；超 256KB 显示截断提示
- [ ] 关闭/再次点击可收起，Esc 可退出

### 写操作

- [ ] 单行启停即时反馈 toast；失败时有内联错误与重试
- [ ] 选择模式：已选 N / 启用 / 禁用 / 退出；批量禁用有内联二次确认
- [ ] 保存后 `$DSH_HOME/skills.enabled.json` 或 `<项目根>/.dsh/skills.enabled.json` 内容正确
- [ ] 保存后禁用 skill 不再注入会话（新会话验证）

### 诊断与空态

- [ ] 异常计数与诊断台条目一致；原因与建议可读，路径可复制
- [ ] 无 skill / 搜索无结果 / 无项目上下文三种空态文案与操作正确

### 体验

- [ ] 深浅主题切换正常，对比度可读
- [ ] 中英文切换（宿主语言）文案正确、无并排双语文案
- [ ] 键盘可走通：Tab 焦点环、空格切开关、Esc 分级退出
- [ ] 1024 / 768 宽度下无横向溢出、无遮挡

## 未验证项（如实记录）

- [ ] Windows 桌面端
- [ ] 大量 skill（>200）时的滚动性能
- [ ] preset/scope 层同名 skill 的禁用覆盖（已知边界，另开 issue）
