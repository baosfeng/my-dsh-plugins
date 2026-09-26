# language: zh-CN
# 验收基准：test/text-fence-markdown.mjs / test/context-markdown.mjs / test/client-render.mjs
# 的 Gherkin 化表达（精简后只保留真增量：宿主渲染为纯文本的地方交给官方 MarkdownText）。
功能: markdown 渲染注入点
  作为使用 DSH 对话的用户
  我想要宿主渲染为纯文本的 markdown 内容也按 markdown 显示
  以便不必阅读原始语法

  场景: text 围栏块按 markdown 渲染并可切回原文
    假如 会话里有语言标记为 text 的围栏块，内容是一段 markdown
    当 插件扫描会话 DOM
    那么 该块内出现官方渲染的 markdown 容器
    并且 该块带「查看原文」切换按钮
    当 点击该块的切换按钮
    那么 该块进入原文视图

  场景: 上下文注入块按 markdown 渲染
    假如 宿主把上下文注入正文渲染为纯文本块
    当 插件扫描会话 DOM
    那么 该纯文本块旁出现官方渲染的 markdown 容器
    并且 原文纯文本块被隐藏

  场景: 非目标语言与缺少官方组件时保持宿主原样
    假如 会话里有语言标记为 js 的围栏块
    而且 平台官方渲染组件不可用
    当 插件扫描会话 DOM
    那么 没有任何块被接管
