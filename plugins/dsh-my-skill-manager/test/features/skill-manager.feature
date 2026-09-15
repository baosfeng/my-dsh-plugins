# language: zh-CN
# 需求来源：GitHub issue + docs/Skill管理/概述.md（R1-R8）+ issue #29（项目视图过滤 / 刷新 / 诊断）
# + issue #91（使用统计）
# 验收基准：test/host-api.mjs、test/client-render.mjs、test/diagnose.mjs、test/usage.mjs 的 Gherkin 化表达

功能: Skill 管理视图与扫描诊断
  作为使用 DSH 设置面板的用户
  我想要按视图查看 skill、手动刷新目录并看到被跳过的条目
  以便新建 skill 后立即可见、并知道哪些 skill 没被收录及原因

  场景: 项目视图只显示该项目的 skill
    假如 全局 skill "web-search" 与项目 skill "codebase-memory" 已存在
    当 以项目路径 "/work/proj" 查询 skill 列表
    那么 列表只包含项目来源的 skill
    并且 列表包含 "codebase-memory"
    并且 列表不包含 "web-search"

  场景: 刷新后新建的 skill 立即可见
    假如 新建了 skill "fresh"
    当 通过刷新接口重新扫描
    那么 刷新接口返回 200
    并且 刷新接口使 skill 目录缓存失效
    并且 刷新结果包含新扫描到的 skill "fresh"

  场景: 被扫描器跳过的条目有诊断提示
    假如 全局 skill 目录存在异常条目 "broken-link"（符号链接无法解析）
    并且 存在缺少 frontmatter 的条目 "no-frontmatter"
    当 查询全局 skill 列表
    那么 列表附带诊断名单
    并且 诊断名单包含 "broken-link" 且原因为 "broken-symlink"
    并且 诊断名单包含 "no-frontmatter" 且原因为 "missing-frontmatter"

  场景: 目录中 frontmatter 正常的条目显示在列表并标记未收录
    假如 全局 skill 目录存在正常条目 "good-skill"
    当 查询全局 skill 列表
    那么 列表包含 "good-skill"
    并且 条目 "good-skill" 标记为未收录
    并且 诊断名单不包含 "good-skill"

  场景: 保存禁用配置后立即生效（回归）
    假如 已保存全局禁用名单 '["web-search"]'
    当 查询全局 skill 列表
    那么 全局禁用名单为 '["web-search"]'
    并且 保存操作使 skill 目录缓存失效

  场景: skill 使用统计（issue #91）
    假如 skill "web-search" 被加载 2 次
    当 查询全局 skill 列表
    那么 列表附带使用统计
    并且 "web-search" 的使用次数为 2
    并且 "web-search" 的使用来源为 "user"
