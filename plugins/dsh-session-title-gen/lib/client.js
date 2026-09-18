/**
 * dsh-session-title-gen — client half (settings tab, issue #385). SOURCE TEMPLATE.
 *
 * 提供「设置 → 插件 → 会话标题生成」设置页签：可视化编辑 8 项配置
 * （enabled / template / provider / model / maxTitleBytes / maxInputBytes /
 * maxOutputTokens / timeoutMs），保存经 PUT 到插件配置端点，由 host 半写回
 * profile 的 cordis.patch.yml 并热生效（详见 src/config-routes.ts）。
 *
 * 本插件的标题生成逻辑全在 server 端，client 半没有其它职责。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 先 tsc 编译
 * src/client/index.ts → lib/.client-build/index.js（CommonJS 单文件），再把编译产物、
 * src/client 的 part 片段（strings.ts / settings.ts 的产物）与 dsh-shared/client-parts
 * 的样式注入件依次注入下方占位符，写出 lib/client.js —— DSH 实际提供的产物（单一
 * __ModuleLoader__ bundle，无相对路径 require）。产物必须提交（CI 只跑
 * node --check + 测试，不跑构建）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-title-gen',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // useState / useEffect 供设置页 part 使用（模板静态分析看不到 part 内容，故在此一并解构）
    const { createElement, useState, useEffect } = require('react')

    // ── 共享样式注入（dsh-shared/client-parts，issue #186 P2）──────────
    // ── shared plugin stylesheet injection (dsh-shared/client-parts) ──
// 单一来源（issue #186 P2）：把「注入 <style data-<plugin>="styles"> 并随 fiber
// teardown 卸载」这段逐字相同的样板从渲染插件收口到这里。当前调用方：
// dsh-md-render（parts/apply.ts）/ dsh-mermaid-render（client/index.ts）/
// dsh-think-zh-expand（client/index.ts）——各自 scripts/build.mjs 在构建期把本
// 文件拼进 __ModuleLoader__ factory 作用域（构建时源文件，不经过 require 解析）。
//
// 为什么「无条件、最先注入、不进早退分支」：样式若挂在某个服务判空之后，
// HMR / 服务缺省时样式就丢了（dsh-file-activity 踩坑，见三处调用点的原注释）。
/**
 * 注入插件样式表，随 ctx fiber 卸载（HMR/禁用无残留）。
 *
 * @param {{ effect: (fn: () => void | (() => void), label?: string) => void }} ctx cordis client ctx
 * @param {string} attr 标识属性名（如 'data-dsh-md-render'；值固定为 'styles'）
 * @param {string} css 样式表文本
 * @param {string} label effect 标签（如 'dsh-md-render: styles'，HMR/调试定位用）
 * @returns {void}
 */
function installStyles(ctx, attr, css, label) {
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute(attr, 'styles')
    style.textContent = css
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, label)
}


    // ── 设置页文案（src/client/strings.ts 产物，issue #385）────────────
    "use strict";
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
const SESSION_TITLE_SETTINGS_TAB_ID = 'session-title-gen-settings';
/** 配置端点（与 host 半 src/config-routes.ts 的 CONFIG_ROUTE_PREFIX + /config 一致）。 */
const SESSION_TITLE_SETTINGS_API = '/session-title-gen/api/config';
/** 当前界面语言是否为中文：宿主 locale（<html lang>）优先，回退 navigator.language。 */
function sessionTitleIsZh() {
    try {
        const lang = document.documentElement?.getAttribute?.('lang');
        if (typeof lang === 'string' && lang !== '')
            return lang.toLowerCase().startsWith('zh');
    }
    catch {
        // 极简宿主 / 测试桩没有 documentElement：回退 navigator.language
    }
    try {
        return (navigator.language || 'en').toLowerCase().startsWith('zh');
    }
    catch {
        return false;
    }
}
/** 按语言二选一（单语；每次调用重新判定，不缓存）。 */
function sessionTitleText(zh, en) {
    return sessionTitleIsZh() ? zh : en;
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
    errorRouteMissing: () => sessionTitleText('服务端插件未加载：' +
        SESSION_TITLE_SETTINGS_API +
        ' 不存在（请确认已安装并启用 dsh-session-title-gen 后重启 DSH）', 'Server plugin not loaded: ' +
        SESSION_TITLE_SETTINGS_API +
        ' is missing (install and enable dsh-session-title-gen, then restart DSH)'),
    errorForbidden: () => sessionTitleText('请求被安全围栏拒绝（403）：请检查网络/代理设置', 'Rejected by the security fence (403): check network/proxy settings'),
    errorNetwork: () => sessionTitleText('网络错误或响应异常：请检查 DSH 服务是否正常运行', 'Network error or unexpected response: check that the DSH server is running'),
    fields: {
        enabled: {
            label: () => sessionTitleText('启用自动标题', 'Auto title generation'),
            hint: () => sessionTitleText('关闭后不再自动生成会话标题', 'When off, no titles are generated automatically'),
        },
        template: {
            label: () => sessionTitleText('标题模板', 'Title template'),
            hint: () => sessionTitleText('{workspace} 表示归属、{description} 表示描述', '{workspace} is the project, {description} the summary'),
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
};


    // ── 设置页视图与注册（src/client/settings.ts 产物，issue #385）──────
    "use strict";
// ── 设置页视图与页签注册（issue #385）：会话标题生成的 8 项配置 ───────────
// 官方 slots 扩展点：设置 → 插件 → 会话标题生成。字段与 host 半一一对应
// （enabled / template / provider / model / maxTitleBytes / maxInputBytes /
// maxOutputTokens / timeoutMs），语义与默认值口径以 src/config.ts 为唯一来源：
// 非法值只影响该字段（host 回退默认并把规整后的值回给本页回填）。
// 保存走 PUT 到插件配置端点 → host 半写回 profile patch（持久化）+ 更新内存生效值
// （保存即生效，不等 patch 热重载、不必重启 DSH）。
//
// 本文件是 part 片段：无 import/export，与 index.ts 的 tsc 产物、strings.ts 的文案件、
// dsh-shared client-parts 共享 __ModuleLoader__ factory 作用域（类型来自 globals.d.ts），
// 由 scripts/build.mjs 注入 lib/client.src.js 的设置页占位符（见该文件与 build.mjs 的
// 设置页占位符常量；此处刻意不写出该占位符字面量，否则产物里会出现第二个同形字面量）。
/** 设置页样式前缀（UI 规范：`dsh-<插件名>-`）。 */
const SESSION_TITLE_SETTINGS_CLASS = 'dsh-session-title-gen-settings';
/** 设置页样式：只用宿主语义变量（--dsw-*），跟随深浅主题，不硬编码色值。 */
const SESSION_TITLE_SETTINGS_STYLES = `
.${SESSION_TITLE_SETTINGS_CLASS}{display:flex;flex-direction:column;gap:8px;padding:12px}
.${SESSION_TITLE_SETTINGS_CLASS}-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.${SESSION_TITLE_SETTINGS_CLASS}-info{display:flex;flex-direction:column;gap:2px;min-width:0;flex:auto}
.${SESSION_TITLE_SETTINGS_CLASS}-label{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.${SESSION_TITLE_SETTINGS_CLASS}-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.${SESSION_TITLE_SETTINGS_CLASS}-input{flex:none;width:190px;max-width:46%;box-sizing:border-box;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.${SESSION_TITLE_SETTINGS_CLASS}-input:focus{outline:none;border-color:var(--dsw-alias-accent)}
.${SESSION_TITLE_SETTINGS_CLASS}-input-multiline{width:100%;max-width:none;min-height:48px;resize:vertical;line-height:1.5}
.${SESSION_TITLE_SETTINGS_CLASS}-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.${SESSION_TITLE_SETTINGS_CLASS}-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.${SESSION_TITLE_SETTINGS_CLASS}-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.${SESSION_TITLE_SETTINGS_CLASS}-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.${SESSION_TITLE_SETTINGS_CLASS}-actions{display:flex;align-items:center;gap:8px;padding-top:2px}
.${SESSION_TITLE_SETTINGS_CLASS}-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.${SESSION_TITLE_SETTINGS_CLASS}-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.${SESSION_TITLE_SETTINGS_CLASS}-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.${SESSION_TITLE_SETTINGS_CLASS}-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.${SESSION_TITLE_SETTINGS_CLASS}-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`;
// ── 表单状态 ─────────────────────────────────────────────────────────
/** 文本项（template 多行，provider / model 单行）。 */
const SESSION_TITLE_TEXT_FIELDS = ['template', 'provider', 'model'];
/** 数字项（host 侧只认正整数，非法值回退默认）。 */
const SESSION_TITLE_NUMBER_FIELDS = ['maxTitleBytes', 'maxInputBytes', 'maxOutputTokens', 'timeoutMs'];
/** 设置页暴露的字段顺序（enabled 开关在最前）。 */
const SESSION_TITLE_FIELDS = ['enabled', ...SESSION_TITLE_TEXT_FIELDS, ...SESSION_TITLE_NUMBER_FIELDS];
/** 首屏（配置未到达前）的表单初值：与 host 半 src/config.ts 的 DEFAULT_SETTINGS 同口径。 */
const SESSION_TITLE_FALLBACK_FORM = {
    enabled: true,
    template: '[{workspace}] {description}',
    provider: '',
    model: '',
    maxTitleBytes: '80',
    maxInputBytes: '4096',
    maxOutputTokens: '64',
    timeoutMs: '30000',
};
/** 数字文本规整：数字原样，其余回退 fallback。 */
function sessionTitleNumberText(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
}
/** 配置快照（GET / PUT 响应）→ 表单值：逐字段规整，缺失 / 非法回退初值。 */
function sessionTitleFormOf(value) {
    const raw = (value ?? {});
    return {
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : SESSION_TITLE_FALLBACK_FORM.enabled,
        template: typeof raw.template === 'string' && raw.template !== '' ? raw.template : SESSION_TITLE_FALLBACK_FORM.template,
        provider: typeof raw.provider === 'string' ? raw.provider : '',
        model: typeof raw.model === 'string' ? raw.model : '',
        maxTitleBytes: sessionTitleNumberText(raw.maxTitleBytes, SESSION_TITLE_FALLBACK_FORM.maxTitleBytes),
        maxInputBytes: sessionTitleNumberText(raw.maxInputBytes, SESSION_TITLE_FALLBACK_FORM.maxInputBytes),
        maxOutputTokens: sessionTitleNumberText(raw.maxOutputTokens, SESSION_TITLE_FALLBACK_FORM.maxOutputTokens),
        timeoutMs: sessionTitleNumberText(raw.timeoutMs, SESSION_TITLE_FALLBACK_FORM.timeoutMs),
    };
}
/** 表单值 → PUT payload：数字项非正数 / 非数字 / 空提交 null（host 按非法值回退默认）。 */
function sessionTitleNumberOrNull(raw) {
    const value = Number(raw);
    return raw.trim() !== '' && Number.isFinite(value) ? value : null;
}
function sessionTitlePayloadOf(form) {
    return {
        enabled: form.enabled,
        template: form.template,
        provider: form.provider,
        model: form.model,
        maxTitleBytes: sessionTitleNumberOrNull(form.maxTitleBytes),
        maxInputBytes: sessionTitleNumberOrNull(form.maxInputBytes),
        maxOutputTokens: sessionTitleNumberOrNull(form.maxOutputTokens),
        timeoutMs: sessionTitleNumberOrNull(form.timeoutMs),
    };
}
/** 设置行（左：标题 + 说明；右：控件）。 */
function SessionTitleSettingsRow(props) {
    return createElement('div', { className: SESSION_TITLE_SETTINGS_CLASS + '-row' }, createElement('div', { className: SESSION_TITLE_SETTINGS_CLASS + '-info' }, createElement('div', { className: SESSION_TITLE_SETTINGS_CLASS + '-label' }, props.label), createElement('div', { className: SESSION_TITLE_SETTINGS_CLASS + '-hint' }, props.hint)), props.control);
}
/** 布尔项控件：button role=switch（UI 规范禁止原生 checkbox）。 */
function sessionTitleToggle(form, onChange) {
    const on = form.enabled;
    return createElement('button', {
        type: 'button',
        className: SESSION_TITLE_SETTINGS_CLASS + '-toggle',
        'data-field': 'enabled',
        'data-on': String(on),
        role: 'switch',
        'aria-checked': String(on),
        onClick: () => onChange('enabled', !on),
    });
}
/** 文本 / 数字项控件（template 用多行输入）。 */
function sessionTitleInput(field, form, onChange) {
    const multiline = field === 'template';
    const numeric = SESSION_TITLE_NUMBER_FIELDS.includes(field);
    const className = multiline
        ? SESSION_TITLE_SETTINGS_CLASS + '-input ' + SESSION_TITLE_SETTINGS_CLASS + '-input-multiline'
        : SESSION_TITLE_SETTINGS_CLASS + '-input';
    return createElement(multiline ? 'textarea' : 'input', {
        className,
        'data-field': field,
        type: numeric ? 'number' : 'text',
        value: String(form[field]),
        onChange: (event) => onChange(field, String(event?.target?.value ?? '')),
    });
}
/** 8 项配置行（顺序固定：开关 → 3 文本 → 4 数字）。 */
function sessionTitleFieldRows(form, onChange) {
    return SESSION_TITLE_FIELDS.map((field) => createElement(SessionTitleSettingsRow, {
        key: field,
        label: SESSION_TITLE_SETTINGS_STRINGS.fields[field].label(),
        hint: SESSION_TITLE_SETTINGS_STRINGS.fields[field].hint(),
        control: field === 'enabled' ? sessionTitleToggle(form, onChange) : sessionTitleInput(field, form, onChange),
    }));
}
/** 加载失败提示：区分 404（服务端插件未加载）/ 403（安全围栏）/ 网络异常。 */
function sessionTitleErrorHint(errorKind) {
    if (errorKind === 'http:404')
        return SESSION_TITLE_SETTINGS_STRINGS.errorRouteMissing();
    if (errorKind === 'http:403')
        return SESSION_TITLE_SETTINGS_STRINGS.errorForbidden();
    return SESSION_TITLE_SETTINGS_STRINGS.errorNetwork();
}
/** 配置加载失败视图：失败原因（http 状态 / 网络）+ 针对性提示 + 重试。 */
function SessionTitleSettingsLoadError(props) {
    const cls = SESSION_TITLE_SETTINGS_CLASS;
    return createElement('div', { className: cls }, createElement('div', { className: cls + '-error' }, SESSION_TITLE_SETTINGS_STRINGS.loadFailed()), createElement('div', { className: cls + '-status' }, sessionTitleErrorHint(props.errorKind)), createElement('div', { className: cls + '-actions' }, createElement('button', { type: 'button', className: cls + '-btn', onClick: props.onRetry }, SESSION_TITLE_SETTINGS_STRINGS.retry())));
}
/** 拉取当前配置并回填表单（成功 / 失败都落到状态上，不静默）。 */
function loadSessionTitleSettings(apply, setLoading, setErrorKind) {
    setLoading(true);
    setErrorKind('');
    fetch(SESSION_TITLE_SETTINGS_API)
        .then((res) => {
        if (!res.ok)
            throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
        return res.json();
    })
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('bad config response');
        apply(sessionTitleFormOf(body.value));
        setLoading(false);
    })
        .catch((err) => {
        setLoading(false);
        // 404 = 路由未注册（服务端插件未加载），403 = 安全围栏拒绝，其余为网络/响应异常。
        setErrorKind(typeof err?.status === 'number' ? 'http:' + err.status : 'network');
    });
}
/** 保存表单（PUT 完整 8 项）；成功用 host 规整后的值回填 + 提示，失败提示不静默。 */
function saveSessionTitleSettings(form, apply, setSaved, setFailed) {
    setSaved(false);
    setFailed(false);
    fetch(SESSION_TITLE_SETTINGS_API, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sessionTitlePayloadOf(form)),
    })
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('save failed');
        // host 已把非法字段回退为默认值：用响应回填，用户看到的是**实际生效值**。
        apply(sessionTitleFormOf(body.value));
        setSaved(true);
    })
        .catch(() => setFailed(true));
}
/** 设置页主视图：加载当前配置 → 编辑 8 项 → 保存（PUT 配置端点）。 */
function SessionTitleSettingsView() {
    const [form, setForm] = useState(SESSION_TITLE_FALLBACK_FORM);
    const [loading, setLoading] = useState(true);
    const [errorKind, setErrorKind] = useState('');
    const [saved, setSaved] = useState(false);
    const [failed, setFailed] = useState(false);
    const cls = SESSION_TITLE_SETTINGS_CLASS;
    const load = () => loadSessionTitleSettings(setForm, setLoading, setErrorKind);
    useEffect(() => {
        load();
    }, []);
    if (loading) {
        return createElement('div', { className: cls }, createElement('div', { className: cls + '-status' }, SESSION_TITLE_SETTINGS_STRINGS.loading()));
    }
    if (errorKind !== '')
        return createElement(SessionTitleSettingsLoadError, { errorKind, onRetry: load });
    // 函数式更新：同一批里连续改多个字段（宿主可能合并渲染）不会用陈旧闭包互相覆盖。
    const onChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
    return createElement('div', { className: cls }, sessionTitleFieldRows(form, onChange), createElement('div', { className: cls + '-actions' }, createElement('button', {
        type: 'button',
        className: cls + '-btn',
        onClick: () => saveSessionTitleSettings(form, setForm, setSaved, setFailed),
    }, SESSION_TITLE_SETTINGS_STRINGS.save()), saved ? createElement('span', { className: cls + '-saved' }, SESSION_TITLE_SETTINGS_STRINGS.saved()) : null, failed ? createElement('span', { className: cls + '-error' }, SESSION_TITLE_SETTINGS_STRINGS.saveFailed()) : null));
}
/**
 * 注册设置页签。两处刻意的写法：
 *  - `ctx.get('slots', false)`：**必须传 strict=false**——cordis 的
 *    `ctx.get(name, strict = true)` 在服务提供者 fiber 尚未 active（首屏）时返回
 *    undefined，页签会消失到下次 HMR；只有 strict=false 才拿得到实例。
 *  - 服务缺失（精简上下文 / 老宿主）时静默跳过：设置页是增强，不能因为拿不到
 *    slots 就让整个 client 挂掉。
 */
function attachSettingsTab(ctx) {
    // 样式注入走共享实现，位置在任何早退分支之前（服务判空 / HMR 时样式不会丢）。
    installStyles(ctx, 'data-dsh-session-title-gen-settings', SESSION_TITLE_SETTINGS_STYLES, 'dsh-session-title-gen: settings styles');
    const slots = typeof ctx.get === 'function' ? ctx.get('slots', false) : undefined;
    if (slots === undefined || slots === null)
        return;
    ctx.effect(() => {
        slots.inject('settings.plugins.tab', () => slots.register({
            name: 'settings.plugins.tab',
            id: SESSION_TITLE_SETTINGS_TAB_ID,
            order: 93,
            // 惰性：宿主靠重注册跟随语言切换，这里每次取都按当前宿主/浏览器语言判定。
            label: () => SESSION_TITLE_SETTINGS_STRINGS.tabLabel(),
        }, SessionTitleSettingsView));
        return undefined;
    }, 'dsh-session-title-gen: settings tab registration');
}


    // ── Client bundle（编译自 src/client/index.ts）──────────────────
    "use strict";
// ── dsh-session-title-gen — client 半入口（设置页签，issue #385）──────────
// 本插件是纯 server 形态（标题生成在主进程完成），client 半只承担一件事：
// 在「设置 → 插件」注册「会话标题生成」设置页，让 8 项配置可可视化编辑
// （此前只能手写 cordis.patch.yml）。
//
// 视图、文案与注册逻辑在 settings.ts / strings.ts（构建期由 build.mjs 注入同一
// factory 作用域；本文件只做入口）。产物 lib/client.js 必须提交（CI 只跑
// node --check + 测试，不跑构建）。
// 注：编译产物内联进 factory 作用域后，module.exports 已在模板中声明。
// 此处直接使用 module.exports（模板顶部已声明 var module = { exports: {} }）。
const _exports = module.exports;
_exports.inject = ['slots'];
_exports.apply = function apply(ctx) {
    // 设置页签（issue #385）：注册「设置 → 插件 → 会话标题生成」。
    // 拿不到 slots（精简上下文 / 老宿主）时静默降级，见 settings.ts 的 attachSettingsTab。
    attachSettingsTab(ctx);
};


    return module.exports
  },
})
