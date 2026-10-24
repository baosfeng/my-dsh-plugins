# language: zh-CN
# 契约来源：docs/原型重构/impl-contract-skill-manager.md（0.2.0 重写）
# 覆盖验收主流程：列表与双作用域 / 启停（含占位 provider 覆盖）/
#               详情（截断与白名单）/ 扫描诊断 / rescan + session 回归

功能: 技能目录的双作用域管理
  作为使用 DSH 设置面板的用户
  我想要在同一份全量列表里看到每个 skill 的全局与本项目启停状态
  以便按项目启停技能、预览 SKILL.md，并知道哪些目录条目没被收录及原因

  场景: 全量列表同时包含全局与项目来源，双作用域互不覆盖
    假如 官方目录包含全局 skill "web-search" 与项目 skill "codebase-memory"
    并且 目录中还有一个未被官方收录的 "scanned-only"
    并且 全局禁用名单已保存为 '["web-search"]'
    并且 项目禁用名单已保存为 '["codebase-memory"]'
    当我以项目上下文查询 skill 列表
    那么 列表返回 200 且列出全部 3 个 skill
    并且 列表同时包含 "user-dsh" 与 "project-dsh" 来源
    并且 全局禁用名单为 '["web-search"]'
    并且 项目禁用名单为 '["codebase-memory"]'
    并且 "scanned-only" 标记为未收录且 provider 为 "filesystem"
    并且 "scanned-only" 带当前扫描路径

  场景: 全局与本项目启停分别写入各自配置并让目录失效
    假如 官方目录包含全局 skill "web-search"
    当我通过接口把全局禁用名单保存为 '["web-search"]'
    那么 保存返回 200 且没有 value
    并且 全局配置文件包含禁用名单 '["web-search"]'
    并且 保存操作让 skill 目录缓存失效一次
    当我通过接口把项目禁用名单保存为 '["web-search"]'
    那么 项目配置文件包含禁用名单 '["web-search"]'
    并且 全局配置文件仍包含禁用名单 '["web-search"]'
    并且 保存操作让 skill 目录缓存失效两次
    并且 禁用占位 provider 列出 "web-search" 且 get 返回 undefined

  场景: 详情读取 SKILL.md，非法名称与白名单外路径被拦截
    假如 全局 skill 目录存在 "detail-skill" 的 SKILL.md：
      """
      # detail
      """
    当我查询 "detail-skill" 的详情
    那么 详情返回 200 且内容与写入内容一致
    并且 详情未被截断
    当我查询 "ghost-skill" 的详情
    那么 详情返回 404 且错误码为 "not-found"
    当我查询 "../escape" 的详情
    那么 详情返回 400 且错误码为 "invalid-name"
    假如 全局 skill 目录的 "escape-feature" 指向白名单外
    当我查询 "escape-feature" 的详情
    那么 详情返回 400 且错误码为 "forbidden"

  场景: 超过 256KB 的 SKILL.md 被截断
    假如 全局 skill 目录存在超大 "huge-skill" 的 SKILL.md（300 KB）
    当我查询 "huge-skill" 的详情
    那么 详情被标记为截断且内容不超过 256 KB

  场景: 三类扫描异常进入诊断，未被收录的正常条目不进诊断
    假如 全局 skill 目录存在坏符号链接 "broken-link"
    并且 全局 skill 目录存在缺 SKILL.md 的 "no-skill-md"
    并且 全局 skill 目录存在缺 frontmatter 的 "no-frontmatter"
    并且 全局 skill 目录存在 frontmatter 正常的 "scanned-only"
    当我查询全局 skill 列表
    那么 诊断名单包含 "broken-link" 且原因为 "broken-symlink"
    并且 诊断名单包含 "no-skill-md" 且原因为 "missing-skill-md"
    并且 诊断名单包含 "no-frontmatter" 且原因为 "missing-frontmatter"
    并且 诊断名单不包含 "scanned-only"
    并且 "scanned-only" 在列表中标记为未收录

  场景: 重新扫描先失效缓存并返回新条目，会话返回 cwd（回归）
    假如 当前会话 "s1" 的工作目录是项目根
    当我查询会话 "s1" 的工作目录
    那么 会话返回项目根
    假如 新建目录条目 "fresh-skill"
    当我通过重新扫描接口刷新列表
    那么 重新扫描返回 200 且使目录缓存失效一次
    并且 重新扫描结果包含 "fresh-skill"
