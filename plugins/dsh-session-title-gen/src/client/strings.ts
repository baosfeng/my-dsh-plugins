// ── 设置页文案与本地化（issue #385）：按当前语言返回**单语** ──────────────
// 判据沿用本仓库设置页惯例（docs/UI规范.md「文案与国际化」）：读到 <html lang>
// （宿主 locale 写入）时优先它，避免「浏览器英文 + 宿主中文」错配；取不到再回退
// navigator.language 前缀判 zh，try/catch 兜底英文。
//
// **文案一律写成惰性函数**（宿主靠重注册跟随语言切换），且**每种语言只出一份**——
// 「中文 (English)」并排塞进同一段会让设置行视觉臃肿，是本仓库已纠正的写法。
// 页签名与英文文案都避开 dsh-think-zh-expand 中文化词表的全等键（该插件会全局改写
// 宿主渲染出的英文串，如 Session log → 会话日志）。
//
// 本文件是 part 片段（无 import/export）：由 scripts/build.mjs 注入
// lib/client.src.js 的文案占位符，与设置页视图件共享 __ModuleLoader__ factory
// 作用域（类型来自 globals.d.ts）。

/** 页签 id：必须全局唯一——复用宿主已发出的 id 会**顶掉**对方那一格（静默故障）。 */
const SESSION_TITLE_SETTINGS_TAB_ID = 'session-title-gen-settings'

/** 配置端点（与 host 半 src/config-routes.ts 的 CONFIG_ROUTE_PREFIX + /config 一致）。 */
const SESSION_TITLE_SETTINGS_API = '/session-title-gen/api/config'

/** 当前界面语言是否为中文：宿主 locale（<html lang>）优先，回退 navigator.language。 */
function sessionTitleIsZh(): boolean {
  try {
    const lang = document.documentElement?.getAttribute?.('lang')
    if (typeof lang === 'string' && lang !== '') return lang.toLowerCase().startsWith('zh')
  } catch {
    // 极简宿主 / 测试桩没有 documentElement：回退 navigator.language
  }
  try {
    return (navigator.language || 'en').toLowerCase().startsWith('zh')
  } catch {
    return false
  }
}

/** 按语言二选一（单语；每次调用重新判定，不缓存）。 */
function sessionTitleText(zh: string, en: string): string {
  return sessionTitleIsZh() ? zh : en
}

/** 设置页文案（页签 / 状态提示 / 每个字段的标题与说明）。 */
const SESSION_TITLE_SETTINGS_STRINGS = {
  tabLabel: () => sessionTitleText('会话标题生成', 'Session titles'),
  loading: () => sessionTitleText('加载中…', 'Loading…'),
  loadFailed: () => sessionTitleText('配置加载失败', 'Failed to load settings'),
  retry: () => sessionTitleText('重试', 'Retry'),
  save: () => sessionTitleText('保存', 'Save'),
  saved: () => sessionTitleText('已保存', 'Saved'),
  saveFailed: () => sessionTitleText('保存失败', 'Save failed'),
  errorRouteMissing: () =>
    sessionTitleText(
      '服务端插件未加载：' +
        SESSION_TITLE_SETTINGS_API +
        ' 不存在（请确认已安装并启用 dsh-session-title-gen 后重启 DSH）',
      'Server plugin not loaded: ' +
        SESSION_TITLE_SETTINGS_API +
        ' is missing (install and enable dsh-session-title-gen, then restart DSH)',
    ),
  errorForbidden: () =>
    sessionTitleText(
      '请求被安全围栏拒绝（403）：请检查网络/代理设置',
      'Rejected by the security fence (403): check network/proxy settings',
    ),
  errorNetwork: () =>
    sessionTitleText(
      '网络错误或响应异常：请检查 DSH 服务是否正常运行',
      'Network error or unexpected response: check that the DSH server is running',
    ),
  fields: {
    enabled: {
      label: () => sessionTitleText('启用自动标题', 'Auto title generation'),
      hint: () => sessionTitleText('关闭后不再自动生成会话标题', 'When off, no titles are generated automatically'),
    },
    template: {
      label: () => sessionTitleText('标题模板', 'Title template'),
      hint: () =>
        sessionTitleText(
          '{workspace} 表示归属、{description} 表示描述',
          '{workspace} is the project, {description} the summary',
        ),
    },
    provider: {
      label: () => sessionTitleText('模型提供方', 'Provider'),
      hint: () => sessionTitleText('留空则跟随当前会话', 'Empty follows the session'),
    },
    model: {
      label: () => sessionTitleText('模型', 'Model'),
      hint: () => sessionTitleText('留空则跟随当前会话', 'Empty follows the session'),
    },
    maxTitleBytes: {
      label: () => sessionTitleText('标题长度上限', 'Max title bytes'),
      hint: () => sessionTitleText('超出部分会被截断', 'Longer titles get truncated'),
    },
    maxInputBytes: {
      label: () => sessionTitleText('输入长度上限', 'Max input bytes'),
      hint: () => sessionTitleText('送入模型的最大输入长度', 'Largest input sent to the model'),
    },
    maxOutputTokens: {
      label: () => sessionTitleText('输出长度上限', 'Max output tokens'),
      hint: () => sessionTitleText('生成标题的最大输出长度', 'Largest output for the title'),
    },
    timeoutMs: {
      label: () => sessionTitleText('超时时间', 'Timeout (ms)'),
      hint: () => sessionTitleText('单次生成的最长等待时间', 'Longest wait for one generation'),
    },
  },
}
