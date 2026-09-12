# language: zh-CN
# 需求来源：docs/记忆/需求清单.md（R1-R12）+ issue #38 / #105 / #107 / #108
# 验收基准：test/store.mjs、test/host-api.mjs、test/prompt.mjs、test/tool.mjs、test/client-render.mjs、test/memory-text.mjs 的 Gherkin 化表达

功能: 记忆管理（全局/项目两级 + 系统提示词注入 + 工具查询 + 用户确认）
  作为使用 DSH 的用户
  我想要持久化全局与项目记忆、让 agent 在会话开始时携带全局记忆、并能查询记忆详情
  以便 agent 记住我的长期偏好与项目约定

  场景: 写操作必须携带用户同意标记
    当 提交未携带同意标记的写操作
    那么 接口返回 400
    并且 记忆列表为空

  场景: 新增/修改/删除全局记忆（带同意标记）
    当 用户确认新增全局记忆 "回复使用中文"
    那么 全局记忆包含 "回复使用中文"
    当 用户确认修改该记忆为 "回复必须使用中文"
    那么 全局记忆包含 "回复必须使用中文"
    当 用户确认删除该记忆
    那么 全局记忆为空

  场景: 项目记忆与全局记忆隔离
    当 用户确认新增全局记忆 "全局偏好"
    并且 用户确认在项目 "proj" 新增项目记忆 "本项目用 vitest"
    那么 全局记忆包含 "全局偏好" 且不包含 "本项目用 vitest"
    当 查询项目 "proj" 的记忆
    那么 项目记忆包含 "本项目用 vitest" 且不包含 "全局偏好"
    当 查询项目 "other" 的记忆
    那么 项目记忆为空

  场景: 会话开始时全局记忆注入系统提示词
    当 用户确认新增全局记忆 "回复使用中文"
    当 组装系统提示词
    那么 系统提示词包含名为 "dsh-my-memory" 的 section
    并且 section 顺序为 -95
    并且 section 文本包含 "回复使用中文"
    当 清空全局记忆
    那么 section 文本为空

  场景: memory_query 工具只读查询记忆详情
    当 用户确认新增全局记忆 "回复使用中文"
    并且 用户确认新增全局记忆 "代码注释用中文"
    当 agent 调用 memory_query 查询全局记忆
    那么 返回两条记忆
    当 agent 以关键词 "代码" 过滤查询
    那么 只返回 "代码注释用中文"
    并且 查询不改变记忆内容

  场景: memory_save 工具保存记忆需经用户确认（issue #107）
    当 agent 调用 memory_save 保存全局记忆 "用户偏好用 pnpm"
    那么 触发用户确认流程（ask 门）
    当 用户批准该保存
    那么 memory_save 写入成功并返回条目 id
    当 查询全局记忆
    那么 全局记忆包含 "用户偏好用 pnpm"

  场景: memory_save 保存后 memory_query 立即查询到
    当 agent 调用 memory_save 保存全局记忆 "用户偏好用 pnpm"
    当 用户批准该保存
    当 agent 调用 memory_query 查询全局记忆
    那么 返回一条记忆
    并且 该记忆内容为 "用户偏好用 pnpm"

  场景: memory_save 不改变其他工具流程
    当 agent 调用 memory_query 查询全局记忆
    那么 查询不触发用户确认流程

  场景: 面板打开时解析当前会话项目根
    当 查询会话 "work-session" 的工作目录
    那么 返回工作目录 "/work/proj"
    当 查询会话 "missing" 的工作目录
    那么 返回空工作目录

  场景: 旧位置项目记忆自动迁移到集中存储（issue #108）
    当 项目 "legacy-proj" 存在旧位置记忆文件
    当 查询项目 "legacy-proj" 的记忆
    那么 项目记忆包含迁移后的旧记忆
    并且 旧位置记忆文件已清理
    并且 项目记忆存于集中存储位置

  场景: 保存长记忆保留完整内容，注入按语义截断不截断句子中间（issue #105）
    当 用户确认新增全局记忆 "第一条完整的话。第二条解释性话语描述更多细节。"
    那么 全局记忆包含 "第一条完整的话。第二条解释性话语描述更多细节。"
    当 组装系统提示词
    那么 section 文本包含 "第一条完整的话。"
    并且 section 文本不包含 "第二条解释性话语"

  场景: 面板拉取条目长度精简引导配置（issue #105）
    当 查询记忆 API 配置
    那么 返回精简单条长度上限 50
    并且 返回单条注入长度上限 200

  场景: 会话结束后自动提取记忆候选进入待确认列表（issue #78）
    当 开启自动学习 autoLearn
    当 会话 "auto-session" 收到用户消息 "请用中文回复我"
    并且 会话 "auto-session" 收到用户消息 "本项目用 vitest 测试"
    当 会话 "auto-session" 结束（顶层 agent idle）
    那么 待确认候选列表包含偏好候选 "请用中文回复我"
    并且 待确认候选列表包含项目候选 "本项目用 vitest 测试"
    并且 正式记忆列表为空

  场景: 用户确认候选后写入记忆，且 autoLearn 关闭时无候选（issue #78）
    当 开启自动学习 autoLearn
    当 会话 "confirm-session" 收到用户消息 "回复使用中文"
    当 会话 "confirm-session" 结束（顶层 agent idle）
    当 用户确认候选 "回复使用中文"
    那么 全局记忆包含 "回复使用中文"
    当 关闭自动学习 autoLearn 且会话 "off-session" 收到用户消息 "回复使用英文"
    当 会话 "off-session" 结束（顶层 agent idle）
    那么 待确认候选列表为空

  场景: 同主题多次确认提升置信度（渐进式更新，issue #78）
    当 开启自动学习 autoLearn
    当 会话 "prog-1" 收到用户消息 "回复使用中文" 并确认候选
    当 会话 "prog-2" 收到用户消息 "回复使用中文" 并确认候选
    那么 全局记忆包含置信度为 2 的 "回复使用中文"

  场景: 记忆条目带分类/来源/置信度元数据（接口返回，issue #78）
    当 开启自动学习 autoLearn
    当 会话 "meta-session" 收到用户消息 "本项目用 vitest 测试"
    当 会话 "meta-session" 结束（顶层 agent idle）
    当 用户确认候选 "本项目用 vitest 测试"
    那么 项目记忆条目带元数据：分类 "stack" 且来源会话为 "meta-session"

  场景: 智能注入按相关性/时效性/置信度选择（issue #78）
    当 组装系统提示词
    那么 section 评分选择器按 相关性+时效性+置信度 选择条目

  场景: 自动提取的候选确认写入需用户同意标记，绝不静默变更（issue #78）
    当 提交未携带同意标记的候选确认
    那么 接口返回 400
    并且 正式记忆列表为空

  场景: danger-full-access（approval policy=never）下 memory_save 免确认写入并标记来源（issue #208/#209）
    当 会话 "auto-session" 的审批策略为 "never" 且 saveApproval 为 "auto"
    当 agent 调用 memory_save 保存全局记忆 "用户偏好用 pnpm"
    那么 保存未经用户确认直接放行
    当 会话 "auto-session" 执行该保存
    那么 全局记忆包含 "用户偏好用 pnpm" 且来源会话为 "auto-session"

  场景: policy=never 且 saveApproval=always 时明确失败并给出可操作提示（issue #208）
    当 会话 "locked-session" 的审批策略为 "never" 且 saveApproval 为 "always"
    当 agent 调用 memory_save 保存全局记忆 "用户偏好用 pnpm"
    那么 保存被明确拒绝且提示包含 "danger-full-access" 与 "saveApproval"
    并且 未写入任何记忆

  场景: workspace-write（approval policy=ask）下仍触发用户确认（issue #208 防回归）
    当 会话 "ask-session" 的审批策略为 "ask" 且 saveApproval 为 "auto"
    当 agent 调用 memory_save 保存全局记忆 "用户偏好用 pnpm"
    那么 触发用户确认流程（ask 门）
    并且 未写入任何记忆
