# language: zh-CN
# 需求来源：GitHub issue + docs/思考增强/概述.md（需求 1、2a、3a）
# 验收基准：host-smoke.mjs / client-render.mjs 的 Gherkin 化表达；新增需求须在此补充场景

功能: 思考增强
  作为使用 DSH 对话的用户
  我想要思考与回复使用中文
  以便阅读体验更符合中文习惯

  场景: 系统提示注入中文思考指令
    假如 思考增强插件已启动
    那么 注册了唯一的 system-prompt section
    并且 section 名为 "dsh-think-zh" 且顺序为 -90
    并且 section 文本要求思考与回复使用中文
    并且 section 文本覆盖关键场景与代码术语

  场景: 工具卡片标题中文化
    假如 客户端模块已加载
    那么 "Search" 的卡片标题为 "搜索"
    并且 "Bash" 的卡片标题为 "命令行"
    并且 "Inspect" 的卡片标题为 "检查"

  场景: 工具名与描述中文化
    假如 客户端模块已加载
    那么 工具名 "web_search" 映射为 "网络搜索"
    并且 工具名 "bash" 映射为 "命令行"
    并且 未覆盖的工具名 "NoSuchTool" 映射为空

  场景: Markdown 表格渲染为表格
    假如 渲染器已注册
    当 渲染含分隔行的文本块
    那么 输出包含 table 标签
    并且 输出包含表头文本 "插件"
    并且 输出包含数据文本 "dsh-file-activity"

  场景: 渲染职责由 dsh-md-render 提供
    假如 客户端模块已加载
    那么 本插件不导出 MarkdownView 渲染组件
    并且 本插件 bundle 不包含表格渲染逻辑

  # issue #293：三级渲染回退（md-render 首选 → 官方 MarkdownText → <pre>）
  场景: 未装 dsh-md-render 时用官方 MarkdownText 兜底
    假如 未装 dsh-md-render 但官方组件可用时渲染器已注册
    当 渲染文本块 "| 插件 | 版本 |"
    那么 输出由官方 MarkdownText 渲染
    并且 传给官方组件的 labels.code.copyLabel 为 "复制"
    并且 输出包含数据文本 "| 插件 | 版本 |"

  场景: md-render 与官方组件都缺失时回退纯文本
    假如 未装 dsh-md-render 且官方组件也缺失时渲染器已注册
    当 渲染文本块 "回退纯文本"
    那么 输出回退为带 fallback 标记的 pre
    并且 输出包含数据文本 "回退纯文本"

  # 真实宿主 MarkdownText 是 React.memo 对象（object($$typeof,type,compare)），
  # 不是函数——用 typeof === 'function' 判可用性会误判为缺失、直接落到 <pre>
  场景: 官方组件是 memo 对象时仍用官方组件渲染
    假如 未装 dsh-md-render 且官方组件为 memo 对象时渲染器已注册
    当 渲染文本块 "memo 形态渲染"
    那么 输出由官方 MarkdownText 渲染
    并且 传给官方组件的 labels.code.copyLabel 为 "复制"
    并且 输出包含数据文本 "memo 形态渲染"

  # issue #383：宿主设置面板（设置 → 插件 → 思考增强）——可视化编辑 defaultExpanded，
  # 保存写回 profile patch 文件（行 id think-zh-expand）并即时生效
  场景: 设置页保存配置写回 profile patch 并即时生效
    假如 思考增强插件已带配置路由启动
    当 通过配置接口保存 defaultExpanded 为 false
    那么 配置接口返回生效值 false
    并且 profile patch 中行 "think-zh-expand" 的 defaultExpanded 为 false
    并且 profile patch 中行 "think-zh-expand" 恰好一条

  # 回归：设置页曾恒报「配置加载失败 … 不存在」（路由 404）。webServer 服务晚于
  # 本插件就绪时，一次性 ctx.get 取值（无重试）会永久错过 → 路由从未注册。
  # 现改为 ctx.inject(['webServer'], cb) 局部等待：服务就绪（含晚到）才注册。
  场景: webServer 晚于插件就绪时配置路由仍注册
    假如 思考增强插件在 webServer 就绪前启动
    当 webServer 服务就绪
    那么 配置路由注册为 "/think-zh-expand/api"
