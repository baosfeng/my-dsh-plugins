/**
 * dsh-my-opencode-session-header — globalThis.fetch 单层补丁。
 *
 * 安装时保存原 fetch 并替换；卸载时**仅当当前 fetch 仍是我们装的那个**
 * 才还原（避免误还原他人的 patch）。包装函数同步判定路由（provider 白名单
 * AND 主机命中），命中且当前有会话上下文时注入会话头；任一不满足或任何
 * 内部异常 → 原样调用原 fetch，零副作用。
 *
 * 安全性：openai SDK 与 anthropic SDK 都在每次请求时解析 globalThis.fetch，
 * 且 DSH 自身没有任何 globalThis.fetch 补丁，故请求前安装即被采用。
 */
import { sessionContext } from './context.js';
import { hasHeader, withHeader } from './headers.js';
/** 补丁层标记属性（不可枚举；用于识别"这一层也是我们装的"）。 */
const LAYER_KEY = 'dshOpencodeSessionHeaderLayer';
/** 安装 fetch 补丁，返回卸载函数（仅还原/摘除自己的补丁层）。 */
export function installFetchPatch(options) {
    const target = globalThis;
    const { patched, layer } = createPatchedFetch(target.fetch, options);
    target.fetch = patched;
    return () => {
        const inner = layer.current();
        if (target.fetch === patched) {
            target.fetch = inner;
            return;
        }
        // 本层被同类补丁压在下面（重复 apply / 乱序卸载）：从链上摘除自己，
        // 不触碰他人的 fetch 实现。
        patchLayerOf(target.fetch)?.rewire(inner);
    };
}
/** 取补丁层（非本插件安装的 fetch 返回 undefined）。 */
function patchLayerOf(value) {
    if (typeof value !== 'function')
        return undefined;
    const layer = value[LAYER_KEY];
    if (layer === null || typeof layer !== 'object')
        return undefined;
    const candidate = layer;
    return typeof candidate.rewire === 'function' && typeof candidate.current === 'function'
        ? candidate
        : undefined;
}
/** 包装原 fetch：命中则注入，否则/异常时原样调用。 */
function createPatchedFetch(initial, options) {
    let inner = initial;
    const patched = (input, init) => {
        try {
            const plan = planInjection(input, init, options);
            return plan === undefined ? inner(input, init) : inner(plan[0], plan[1]);
        }
        catch {
            // 插件内部任何异常都必须降级为原行为，绝不阻断推理请求。
            return inner(input, init);
        }
    };
    const layer = {
        rewire: (next) => {
            inner = next;
        },
        current: () => inner,
    };
    Object.defineProperty(patched, LAYER_KEY, { value: layer });
    return { patched, layer };
}
/** 判定是否注入；命中返回 [input, init]，否则 undefined。 */
function planInjection(input, init, options) {
    const url = urlOf(input);
    if (url === undefined || !hostMatches(url, options.hosts))
        return undefined;
    const store = storeForRequest(options);
    if (store === undefined || !options.providers.includes(store.provider))
        return undefined;
    if (!options.override && hasHeader(headersOf(input, init), options.headerName))
        return undefined;
    return applyHeader(input, init, options.headerName, store.value);
}
/** 取当前会话上下文；缺失时按"退化"告警一次并放弃注入。 */
function storeForRequest(options) {
    const store = sessionContext.getStore();
    if (store !== undefined && store.value !== '')
        return store;
    options.warnOnce(`[opencode-session-header] host matched but no llm session context; ${options.headerName} not injected`);
    return undefined;
}
/** 注入头：优先 init.headers（Headers/数组/对象三种形态），其次 Request 实例。 */
function applyHeader(input, init, name, value) {
    const initHeaders = propertyOf(init, 'headers');
    if (initHeaders !== undefined)
        return [input, { ...init, headers: withHeader(initHeaders, name, value) }];
    if (isRequestInstance(input))
        return [withRequestHeader(input, name, value), init];
    return [input, { ...init, headers: { [name]: value } }];
}
/** init / Request 上现有的请求头（用于幂等判定）。 */
function headersOf(input, init) {
    const initHeaders = propertyOf(init, 'headers');
    if (initHeaders !== undefined)
        return initHeaders;
    return isRequestInstance(input) ? propertyOf(input, 'headers') : undefined;
}
/** 请求目标 URL（string / URL / Request 三种形态）。 */
function urlOf(input) {
    if (typeof input === 'string')
        return input;
    if (input instanceof URL)
        return input.href;
    const url = propertyOf(input, 'url');
    return typeof url === 'string' ? url : undefined;
}
/** 主机命中判定：精确匹配或子域（`zen.opencode.ai` 命中 `opencode.ai`）。 */
export function hostMatches(url, hosts) {
    const hostname = hostnameOf(url);
    if (hostname === undefined)
        return false;
    return hosts.some((host) => {
        const wanted = host.toLowerCase();
        return hostname === wanted || hostname.endsWith(`.${wanted}`);
    });
}
/** URL → 主机名（不可解析返回 undefined）。 */
function hostnameOf(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    }
    catch {
        return undefined;
    }
}
/** 属性读取（非对象或不可读时返回 undefined）。 */
function propertyOf(target, key) {
    if (target === null || typeof target !== 'object')
        return undefined;
    return target[key];
}
/** 是否为 Request 实例（仅在构造器可用时判定）。 */
function isRequestInstance(value) {
    const ctor = globalThis.Request;
    if (typeof ctor !== 'function')
        return false;
    return value instanceof ctor;
}
/** 复制 Request 并合入会话头（不改动原 Request）。 */
function withRequestHeader(request, name, value) {
    const ctor = globalThis.Request;
    if (ctor === undefined)
        return request;
    return new ctor(request, { headers: withHeader(propertyOf(request, 'headers'), name, value) });
}
