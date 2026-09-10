/**
 * dsh-task-reliability — 会话级死循环检测状态与干预辅助（issue #77）。
 *
 * 依赖 constants.js（TOOL_LOOP_BUFFER）与 repeat.js（detectToolCallLoop）。
 * 本模块集中管理会话级 loop 状态（repeatStateOf）与多维度的检测/干预辅助：
 *  - detectNoProgress：无进展判定（连续 N 轮无有效产出）；
 *  - recordToolLoop：记录工具调用并检测循环；
 *  - loopNotify：可选的 dsh-my-notify 通知（best-effort）；
 * 供 events.js 装配与 repeat.js 复用（避免 events.js 超尺寸）。
 */
import { TOOL_LOOP_BUFFER } from './constants.js';
import { detectToolCallLoop } from './repeat.js';
/** 思考/工具循环检测状态（会话级）。 */
export function repeatStateOf(sessionId, shared) {
    let state = shared.repeatStates.get(sessionId);
    if (state === undefined) {
        state = {
            count: 0,
            gaveUp: false,
            notified: false,
            lastKind: null,
            pendingBreak: null,
            // issue #153：pendingBreak 绑定命中回合（turnSeq），跨回合自动失效。
            pendingBreakTurn: null,
            turnSeq: 0,
            toolCalls: [],
            progress: { seenOutput: false, productCount: 0, lastProduct: null, stallCount: 0 },
        };
        shared.repeatStates.set(sessionId, state);
    }
    return state;
}
/** 无进展检测：连续 N 轮无有效产出（非 reasoning 文本 / 工具执行）判定循环。 */
export function detectNoProgress(repeat, options) {
    if (repeat === undefined || !repeat.progress.seenOutput)
        return false;
    if (options.noProgressRounds <= 0)
        return false;
    const current = repeat.progress.productCount;
    if (repeat.progress.lastProduct === null) {
        repeat.progress.lastProduct = current;
        return false;
    }
    if (current > repeat.progress.lastProduct) {
        repeat.progress.lastProduct = current;
        repeat.progress.stallCount = 0;
        return false;
    }
    if (repeat.progress.stallCount >= options.noProgressRounds)
        return false;
    repeat.progress.stallCount += 1;
    return repeat.progress.stallCount >= options.noProgressRounds;
}
/** 工具参数摘要：键排序 + 截断，用于同工具同参的循环比对。 */
function argSummaryOf(exec) {
    try {
        const args = exec.arguments;
        if (args === null || typeof args !== 'object')
            return '';
        const json = JSON.stringify(args, Object.keys(args).sort());
        return json.length > 200 ? json.slice(0, 200) : json;
    }
    catch {
        return '';
    }
}
/**
 * 记录一次工具调用并检测循环。每次工具请求都作为「有效产出」推进 progress，
 * 因此工具循环由工具序列检测负责、无进展检测只针对「既无结论也无工具」的
 * 空转。命中循环时更新计数/打断标记并返回 true（调用方决定如何中断）。
 *
 * issue #153：只读工具（轮询类重复读取）不纳入序列检测；pendingBreak 绑定
 * 命中回合（pendingBreakTurn），跨回合由 events.js 消费时校验失效。
 */
export function recordToolLoop(sessionId, exec, shared) {
    const repeat = repeatStateOf(sessionId, shared);
    repeat.progress.seenOutput = true;
    repeat.progress.productCount += 1;
    // 交互式询问（ask_user_question）不是「死循环」式的工作执行，且重复询问由
    // ask 超时自动决策 + 待确认去重机制处理，不纳入工具序列循环检测。
    if (exec.name === 'ask_user_question')
        return false;
    // 只读工具（snapshot/eval/read 等无副作用工具）的连续调用是「有进展的重复
    // 读取」（轮询等待变化），不纳入「连续同工具同参」检测，避免误判死循环。
    if (shared.options.toolLoopReadonlyTools.has(exec.name))
        return false;
    repeat.toolCalls.push({ name: exec.name, arg: argSummaryOf(exec) });
    if (repeat.toolCalls.length > TOOL_LOOP_BUFFER)
        repeat.toolCalls.shift();
    if (repeat.gaveUp)
        return false;
    if (!detectToolCallLoop(repeat.toolCalls, shared.options))
        return false;
    repeat.count += 1;
    if (repeat.count > shared.options.repeatMaxPerSession) {
        repeat.gaveUp = true;
        repeat.notified = false;
        return false;
    }
    repeat.lastKind = 'tool';
    repeat.pendingBreak = 'tool';
    repeat.pendingBreakTurn = repeat.turnSeq;
    return true;
}
/** 可选：检测到循环时经 dsh-my-notify 的 trigger 接口推送通知（best-effort）。 */
export async function loopNotify(shared, kind, sessionId) {
    const url = shared.options.notifyUrl;
    if (!shared.options.notifyOnLoop || typeof url !== 'string' || url === '')
        return;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'loop', kind, sessionId, message: `检测到死循环（${kind}）` }),
        });
    }
    catch {
        // 通知通道为可选增强，失败不影响主流程。
    }
}
