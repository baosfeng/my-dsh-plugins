/**
 * dsh-my-notify — 出站 webhook 渠道适配器（issue #92）。
 *
 * 本文件是「渠道适配」的稳定对外门面，具体实现已下沉到 src/notify/：
 *  - notify/vars.ts     — 模板变量目录与取值（含旧语法别名）
 *  - notify/template.ts — 单次扫描渲染（{{ns.var}} + {old}）
 *  - notify/channels.ts — 各渠道消息组装（wecom / feishu / dingtalk / generic，
 *                         含飞书 interactive 卡片）
 *
 * 签名规则（各渠道不同，均为纯函数，接受显式 now 便于单测断言确定性）：
 *  - wecom    sha256(timestamp + '\n' + secret)，hex 小写，URL 参数
 *  - feishu   base64(hmac_sha256(secret, timestamp + '\n' + secret))，body 字段
 *  - dingtalk base64(hmac_sha256(secret, timestamp + '\n' + secret))，URL 参数
 *  - generic  不签名
 *
 * ⚠️ 加签时间戳的**单位是秒**（三家官方一致）。调用方传的是 Date.now() 的
 * 毫秒值，必须经 toTimestampSeconds 换算——直接传毫秒会与官方校验不一致，
 * 线上表现为「签名校验失败」（issue 修复 + 回归用例）。
 */
import { createHash, createHmac } from 'node:crypto';
import { buildVars, kindLabel } from '../notify/vars.js';
import { render } from '../notify/template.js';
import { formatChannelMessage } from '../notify/channels.js';
/** 事件类型中文标签（未知类型回退「提示」）。 */
export { kindLabel };
/**
 * 渲染自定义模板（旧入口，语义 = buildVars + 单次扫描渲染）。
 *
 * 支持新语法 `{{session.title}}` 与旧语法 `{title}`；未识别的占位符原样
 * 保留（便于用户发现拼写错误）；模板为空返回空串。
 *
 * @example
 *   renderTemplate('{title}｜{{event.name}}', notice)
 *   // → '演示项目｜会话已结束'
 */
export function renderTemplate(template, notice) {
    if (typeof template !== 'string' || template === '')
        return '';
    return render(template, buildVars(notice));
}
/**
 * 按渠道构造消息 JSON（委托 notify/channels.ts）。
 *
 * @example
 *   formatMessage({ channel: 'feishu', msgType: 'interactive' }, notice)
 *   // → { msg_type: 'interactive', card: { schema: '2.0', ... } }
 */
export function formatMessage(channel, notice, opts) {
    return formatChannelMessage(channel, notice, opts);
}
/**
 * 把毫秒时间戳换算为加签用的**秒级**时间戳（幂等：已是秒则原样返回）。
 *
 * 阈值取 1e11（约公元 5138 年才达到的秒数），因此 10 位秒值 → 原样，
 * 13 位毫秒值 → 整除 1000；非法值回退当前秒级时间。
 *
 * @example
 *   toTimestampSeconds(1700000000000) // → 1700000000
 *   toTimestampSeconds(1700000000)    // → 1700000000
 */
export function toTimestampSeconds(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return Math.floor(Date.now() / 1000);
    }
    return value >= 1e11 ? Math.floor(value / 1000) : Math.floor(value);
}
/**
 * 生成签名参数：返回 `{ query, body }`——query 追加到 URL，body 为最终
 * 请求体。无 secret 或渠道不支持签名时返回原样（query 为空对象）。
 *
 * `now` 必须是**秒级**时间戳（调用方用 toTimestampSeconds 换算毫秒）。
 */
export function sign(channel, secret, body, now = Math.floor(Date.now() / 1000)) {
    const type = channelTypeOf(channel);
    if (typeof secret !== 'string' || secret === '')
        return { query: {}, body };
    if (type === 'wecom')
        return { query: wecomSign(secret, now), body };
    if (type === 'feishu')
        return { query: {}, body: feishuSign(secret, now, body) };
    if (type === 'dingtalk')
        return { query: dingtalkSign(secret, now), body };
    return { query: {}, body };
}
/** 渠道类型：webhook 配置字段为 channel（兼容 type 别名）。 */
function channelTypeOf(channel) {
    const c = channel;
    return c.channel ?? c.type;
}
/** 企微加签：sha256(timestamp + '\n' + secret)，hex 小写。 */
function wecomSign(secret, now) {
    const digest = createHash('sha256').update(`${now}\n${secret}`, 'utf8').digest('hex');
    return { timestamp: String(now), sign: digest };
}
/** 飞书签名校验：base64(hmac_sha256(key=secret, timestamp + '\n' + secret))。 */
function feishuSign(secret, now, body) {
    const stringToSign = `${now}\n${secret}`;
    const digest = createHmac('sha256', secret).update(stringToSign, 'utf8').digest('base64');
    return { ...body, timestamp: String(now), sign: digest };
}
/** 钉钉加签：base64(hmac_sha256(key=secret, timestamp + '\n' + secret))；
 *  URL 编码由 buildUrl（searchParams）统一处理，避免二次编码。 */
function dingtalkSign(secret, now) {
    const stringToSign = `${now}\n${secret}`;
    const digest = createHmac('sha256', secret).update(stringToSign, 'utf8').digest('base64');
    return { timestamp: String(now), sign: digest };
}
