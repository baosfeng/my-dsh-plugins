/**
 * dsh-my-notify — 出站 webhook 渠道适配器（issue #92）。
 *
 * 按渠道类型把通知帧格式化为目标机器人 API 的消息 JSON，并按各渠道的
 * 签名规则生成签名参数：
 *
 *  - wecom    企业微信群机器人：text / markdown 消息；可选加签
 *             （`sign = sha256(timestamp + '\n' + secret)`，hex 小写，
 *             URL 参数 timestamp + sign）
 *  - feishu   飞书自定义机器人：text / post 消息；签名校验
 *             （`sign = base64(hmac_sha256(key=secret, timestamp + '\n' +
 *             secret))`，body 字段 timestamp + sign）
 *  - dingtalk 钉钉自定义机器人：text / markdown 消息；加签
 *             （`sign = urlencode(base64(hmac_sha256(key=secret,
 *             timestamp + '\n' + secret)))`，URL 参数 timestamp + sign）
 *  - generic  通用中转：POST 原始通知帧 JSON（无签名）
 *
 * 全部为纯函数（sign 接受显式 now 便于单测断言确定性），不发起网络请求。
 */
import { createHash, createHmac } from 'node:crypto';
/** 事件类型 → 中文标签（与 client 端 i18n 文案一致）。 */
const KIND_LABELS = {
    end: '会话已结束',
    ask: '需要你回答',
    approval: '等待你的批准',
    remote: '提示',
};
/** 事件类型中文标签（未知类型回退「提示」）。 */
export function kindLabel(kind) {
    return KIND_LABELS[kind] ?? KIND_LABELS.remote;
}
/** 通知摘要：note 优先，回退 toolName，再回退空串。 */
function noticeNote(notice) {
    if (typeof notice.note === 'string' && notice.note !== '')
        return notice.note;
    if (typeof notice.toolName === 'string' && notice.toolName !== '')
        return notice.toolName;
    return '';
}
/** ask 主内容：默认完整问题（多问题全部列出），`opts.askFull === false` 时回退摘要。 */
function askContent(notice, opts) {
    const full = typeof notice.question === 'string' && notice.question !== '';
    if (full && opts?.askFull !== false)
        return notice.question;
    return noticeNote(notice);
}
/** 消息正文内容：ask 用完整问题（或摘要），approval 用原因，其余用 note。 */
function noticeContent(notice, opts) {
    if (notice.kind === 'ask')
        return askContent(notice, opts);
    if (notice.kind === 'approval')
        return typeof notice.note === 'string' ? notice.note : '';
    return noticeNote(notice);
}
/** 消息正文行：`类型：内容`（内容为空时只显示类型）。 */
function noticeLine(notice, opts) {
    const label = kindLabel(notice.kind);
    const content = noticeContent(notice, opts);
    return content !== '' ? `${label}：${content}` : label;
}
/** 富格式附加行（end：token/耗时/链接；approval：工具名）。 */
function enrichLines(notice) {
    const lines = [];
    if (notice.kind === 'end') {
        const tokens = tokensText(notice.tokens);
        if (tokens !== '')
            lines.push(`token 消耗：${tokens}`);
        const duration = durationText(notice.duration);
        if (duration !== '')
            lines.push(`会话耗时：${duration}`);
        if (typeof notice.sessionUrl === 'string' && notice.sessionUrl !== '') {
            lines.push(`会话链接：${notice.sessionUrl}`);
        }
    }
    if (notice.kind === 'approval') {
        if (typeof notice.toolName === 'string' && notice.toolName !== '') {
            lines.push(`调用工具：${notice.toolName}`);
        }
    }
    return lines;
}
/** token 消耗文本：输入/输出/总计；不可用返回「不可用」。 */
function tokensText(tokens) {
    if (tokens === null || typeof tokens !== 'object')
        return '不可用';
    const t = tokens;
    const input = nonNegative(t.input);
    const output = nonNegative(t.output);
    const total = nonNegative(t.total);
    if (input === 0 && output === 0 && total === 0)
        return '不可用';
    return `输入 ${input} / 输出 ${output} / 总计 ${total}`;
}
/** 会话耗时文本：秒/分秒/时分秒；无耗时返回空串。 */
function durationText(duration) {
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)
        return '';
    const totalSeconds = Math.round(duration);
    if (totalSeconds === 0)
        return '0 秒';
    if (totalSeconds < 60)
        return `${totalSeconds} 秒`;
    if (totalSeconds < 3600) {
        const min = Math.floor(totalSeconds / 60);
        const sec = totalSeconds % 60;
        return sec !== 0 ? `${min} 分 ${sec} 秒` : `${min} 分`;
    }
    const hour = Math.floor(totalSeconds / 3600);
    const min = Math.floor((totalSeconds % 3600) / 60);
    return `${hour} 小时 ${min} 分`;
}
/** 时间文本：`YYYY-MM-DD HH:mm`（本地时区）。 */
function timeText(now) {
    const date = typeof now === 'number' ? new Date(now) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/** 模板变量值：模板渲染取值（含 tokens/question/sessionUrl/time 等）。 */
function templateVars(notice) {
    return {
        title: noticeTitle(notice),
        kind: kindLabel(notice.kind),
        note: noticeNote(notice),
        tokens: tokensText(notice.tokens),
        question: typeof notice.question === 'string' && notice.question !== '' ? notice.question : noticeNote(notice),
        sessionUrl: typeof notice.sessionUrl === 'string' ? notice.sessionUrl : '',
        time: timeText(notice.time),
    };
}
/**
 * 渲染自定义模板：把 `{title}` / `{kind}` / `{note}` / `{tokens}` /
 * `{question}` / `{sessionUrl}` / `{time}` 等变量替换为对应值。
 * 未识别的 `{xxx}` 原样保留（便于用户发现拼写错误）。模板为空返回空串。
 */
export function renderTemplate(template, notice) {
    if (typeof template !== 'string' || template === '')
        return '';
    const vars = templateVars(notice);
    let out = template;
    for (const [key, value] of Object.entries(vars)) {
        out = out.split(`{${key}}`).join(String(value));
    }
    return out;
}
/** 消息标题（回退「DSH 通知」）。 */
function noticeTitle(notice) {
    return typeof notice.title === 'string' && notice.title !== '' ? notice.title : 'DSH 通知';
}
/** 渠道类型：webhook 配置字段为 channel（兼容 type 别名）。 */
function channelType(channel) {
    const c = channel;
    return c.channel ?? c.type;
}
/** 构造消息 JSON（按渠道 + msgType；generic 直接返回通知帧）。 */
export function formatMessage(channel, notice, opts) {
    const type = channelType(channel);
    const template = channel.template;
    const bodyText = renderTemplate(template, notice);
    if (template !== undefined && bodyText !== '')
        return textBody(type, notice, channel, bodyText);
    const title = noticeTitle(notice);
    const line = messageLine(notice, opts);
    const msgType = channel.msgType ?? 'text';
    if (type === 'generic')
        return { ...notice };
    if (type === 'wecom')
        return wecomMessage(msgType, title, line);
    if (type === 'feishu')
        return feishuMessage(msgType, title, line);
    if (type === 'dingtalk')
        return dingtalkMessage(msgType, title, line);
    // 未知渠道按 generic 处理（尽力而为，不打断推送路径）
    return { ...notice };
}
/** 默认消息正文：`类型：内容` + 附加行。 */
function messageLine(notice, opts) {
    return [noticeLine(notice, opts), ...enrichLines(notice)].filter((line) => line !== '').join('\n');
}
/** 模板渲染结果：直接作为渠道消息正文（不再重复加标题前缀）。 */
function textBody(type, notice, channel, text) {
    const msgType = channel.msgType ?? 'text';
    return wrapContent(type, msgType, noticeTitle(notice), text, notice);
}
/** 完整文本 → 渠道消息 JSON（title 仅作为 post/markdown 元数据，content 用已渲染文本）。 */
function wrapContent(type, msgType, title, text, notice) {
    if (type === 'wecom') {
        if (msgType === 'markdown')
            return { msgtype: 'markdown', markdown: { content: text } };
        return { msgtype: 'text', text: { content: text } };
    }
    if (type === 'feishu') {
        if (msgType === 'post') {
            return {
                msg_type: 'post',
                content: { post: { zh_cn: { title, content: [[{ tag: 'text', text }]] } } },
            };
        }
        return { msg_type: 'text', content: { text } };
    }
    if (type === 'dingtalk') {
        if (msgType === 'markdown') {
            return { msgtype: 'markdown', markdown: { title, text: `### ${title}\n\n${text}` } };
        }
        return { msgtype: 'text', text: { content: text } };
    }
    return { ...notice, message: text };
}
/** 非负数值，非法回退 0。 */
function nonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
/** 企微消息：text / markdown。 */
function wecomMessage(msgType, title, line) {
    if (msgType === 'markdown') {
        return { msgtype: 'markdown', markdown: { content: `**${title}**\n${line}` } };
    }
    return { msgtype: 'text', text: { content: `${title}\n${line}` } };
}
/** 飞书消息：text / post。 */
function feishuMessage(msgType, title, line) {
    if (msgType === 'post') {
        return {
            msg_type: 'post',
            content: { post: { zh_cn: { title, content: [[{ tag: 'text', text: line }]] } } },
        };
    }
    return { msg_type: 'text', content: { text: `${title}\n${line}` } };
}
/** 钉钉消息：text / markdown。 */
function dingtalkMessage(msgType, title, line) {
    if (msgType === 'markdown') {
        return { msgtype: 'markdown', markdown: { title, text: `### ${title}\n\n${line}` } };
    }
    return { msgtype: 'text', text: { content: `${title}\n${line}` } };
}
/**
 * 生成签名参数：返回 `{ query, body }`——query 追加到 URL，body 为最终
 * 请求体。无 secret 或渠道不支持签名时返回原样（query 为空对象）。
 */
export function sign(channel, secret, body, now = Date.now()) {
    const type = channelType(channel);
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
