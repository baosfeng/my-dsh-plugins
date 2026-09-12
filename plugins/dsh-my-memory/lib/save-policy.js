/**
 * dsh-my-memory — 权限模式感知的保存确认策略（issue #208）。
 *
 * 背景：`danger-full-access` preset 的 approval policy 是 `never`，宿主
 * ApprovalService.decide() 对 never 会话里的一切 ask **直接判 rejected**
 * （dsh-user-approval/lib/index.js:178），因此 `tools/pre-execute` 返回
 * `{ kind: 'ask' }` 的写操作在该模式下 100% 失败，且用户看不到任何弹窗
 * （#191 修复后 memory_save 仍然「存不了记忆」的第二环根因）。
 *
 * 本模块把「是否确认」从写死的 ask 改成**权限模式感知 + 可配置**：
 *  - `saveApproval: 'auto'`（默认）：policy=never 时直接写入（用户选择该
 *    模式即已表达对 agent 的信任）；条目仍标记来源、面板可见可撤销；
 *    policy=ask 时保持原生确认（行为不变）；
 *  - `'always'`：始终要求确认；policy=never 时明确失败并给出可操作提示；
 *  - `'never'`：从不确认（高级用法）。
 *
 * policy 判定（两条途径，均与宿主实现同源）：
 *  1. 宿主 approval 服务探针 `ApprovalService.effectivePolicy(session)`
 *     （dsh-user-approval/lib/index.js:155-157）——与宿主 decide() 同一函数；
 *  2. 会话日志折返：向前扫描 `approval/policy` 事件
 *     （dsh-user-approval/lib/index.js:163-168 的 overrideOf 同构；该事件由
 *     dsh-permission-presets/lib/index.js:293-311 在会话创建时写入），
 *     无事件时回落到宿主 approval 配置默认值 `'ask'`。
 * 两条途径都不可用时返回 `undefined`（未知）→ 按 ask 保守处理，不误放行。
 */
/**
 * `always` + policy=never 的失败提示：可操作、中文、不是笼统 rejected。
 * （方案 B：失败可见化——模型能把这段原因原样转述给用户。）
 */
const ALWAYS_UNDER_NEVER_HINT = '当前会话的审批策略为 never（不会弹出确认窗口，典型配置是 danger-full-access 预设），' +
    '插件配置 saveApproval=always 要求每次保存都经用户确认，故本次保存未执行。' +
    '请任选其一后重试：① 在插件配置中把 saveApproval 改为 auto（该模式下自动保存并标记来源）或 never；' +
    '② 把会话 preset 切到 workspace-write（该模式会弹出确认窗口）；' +
    '③ 让用户直接在记忆面板手动新增这条记忆。';
/** 归一化 `saveApproval` 配置；非法值回落 'auto'。 */
export function saveApprovalOf(config) {
    const value = config?.saveApproval;
    return value === 'always' || value === 'never' ? value : 'auto';
}
/** 调用 agent 的会话对象（`exec.agent.session`）。 */
function sessionOf(exec) {
    const agent = exec?.agent;
    return agent?.session;
}
/** 宿主 approval 服务探针的合法取值（非法/抛错一律视为「无结论」）。 */
function probePolicyOf(probe, session) {
    if (typeof probe !== 'function')
        return undefined;
    try {
        const value = probe(session);
        return value === 'ask' || value === 'never' ? value : undefined;
    }
    catch {
        return undefined;
    }
}
/** 会话日志的读取器（宿主 Session 的 `seq` + `eventAt` 契约）。 */
function logReaderOf(session) {
    const candidate = session;
    if (typeof candidate?.eventAt !== 'function')
        return undefined;
    const seq = typeof candidate.seq === 'number' && Number.isFinite(candidate.seq) ? candidate.seq : undefined;
    if (seq === undefined || seq < 0)
        return undefined;
    const readEvent = candidate.eventAt;
    return { seq, eventAt: (index) => readEvent.call(candidate, index) };
}
/** 一个 `approval/policy` 事件的策略取值（其余事件/取值返回 undefined）。 */
function policyOfEvent(event) {
    const eventObj = event;
    if (eventObj?.type !== 'approval/policy')
        return undefined;
    const policy = eventObj.data?.policy;
    return policy === 'ask' || policy === 'never' ? policy : undefined;
}
/**
 * 折返会话日志里最后一个 `approval/policy`（宿主 overrideOf 同构）。
 * 无该事件时返回宿主 approval 配置的默认值 'ask'；日志不可读返回 undefined。
 */
function foldPolicyOf(session) {
    const log = logReaderOf(session);
    if (log === undefined)
        return undefined;
    for (let index = log.seq - 1; index >= 0; index -= 1) {
        const policy = policyOfEvent(log.eventAt(index));
        if (policy !== undefined)
            return policy;
    }
    return 'ask';
}
/**
 * 判定一次工具调用所属会话的审批策略（issue #208）。
 * @param exec 宿主 `ToolExecution`（`tools/pre-execute` 第一参数，含 agent）。
 * @param probe 宿主 approval 服务探针；无结论时回落会话日志折返。
 * @returns 'ask' / 'never'，两者都判不出时 undefined（未知）。
 */
export function approvalPolicyOf(exec, probe) {
    const session = sessionOf(exec);
    if (session === undefined)
        return undefined;
    return probePolicyOf(probe, session) ?? foldPolicyOf(session);
}
/** 保存范围的用户可见名（用于确认/失败文案）。 */
function scopeLabelOf(args) {
    return args?.scope === 'project' ? '项目' : '全局';
}
/** 单行 desc 摘要（确认/失败文案用；超长截断）。 */
function descSnippet(desc) {
    const oneLine = typeof desc === 'string' ? desc.trim().split('\n')[0] : '';
    if (oneLine === '')
        return '（空内容）';
    return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine;
}
/** 原生确认门的 reason（记忆绝不静默变更的自述）。 */
function askReasonOf(args) {
    return `dsh-my-memory：agent 请求保存${scopeLabelOf(args)}记忆「${descSnippet(args?.desc)}」。记忆绝不静默变更，请确认是否保存`;
}
/**
 * decideSaveGate — saveApproval 三态 × policy 两态 的决策矩阵（issue #208）：
 *
 * | saveApproval | policy=ask            | policy=never              | 判定不出 |
 * | ------------ | --------------------- | ------------------------- | -------- |
 * | auto（默认） | ask（原生确认，不变） | allow（直接写入，标记来源） | ask      |
 * | always       | ask（原生确认）       | deny（可操作提示）         | ask      |
 * | never        | allow                 | allow                     | allow    |
 *
 * @param input.args memory_save 参数（写文案用）。
 * @param input.policy 本会话审批策略（undefined = 未知）。
 * @param input.config 插件配置（只读 saveApproval）。
 * @returns allow（不确认）/ ask（原生确认）/ deny（明确失败 + 提示）。
 */
export function decideSaveGate(input) {
    const mode = saveApprovalOf(input.config);
    if (mode === 'never')
        return { kind: 'allow' };
    if (mode === 'always' && input.policy === 'never')
        return { kind: 'deny', reason: ALWAYS_UNDER_NEVER_HINT };
    if (mode === 'auto' && input.policy === 'never')
        return { kind: 'allow' };
    return { kind: 'ask', reason: askReasonOf(input.args) };
}
/**
 * The `tools/pre-execute` approval gate for memory_save (issue #107, policy
 * aware since issue #208).
 *
 * Waterfall contract: every listener must first `await next()` to obtain the
 * downstream decision, then decide whether to override it. The decision comes
 * from {@link decideSaveGate} — `{ kind: 'ask', reason }` triggers the DSH
 * native approval flow (approval.request); under an approval policy of
 * `never` (danger-full-access) the host auto-rejects every ask
 * (dsh-user-approval/lib/index.js:178), so the gate either lets the write
 * through (`saveApproval: 'auto'`) or denies it with an actionable hint
 * (`'always'`) instead of failing invisibly. All other tools pass the
 * downstream decision through, so the gate never changes unrelated tool flows.
 */
export function createMemorySaveGate(options) {
    return async (exec, next) => {
        const downstream = await next();
        if (exec?.name !== 'memory_save')
            return downstream;
        return saveGateDecision(exec, downstream, options);
    };
}
/** 决策 + 日志（拆出为独立函数以守住圈复杂度 ≤ 10 门禁）。 */
function saveGateDecision(exec, downstream, options) {
    const policy = approvalPolicyOf(exec, options?.probePolicy);
    const save = decideSaveGate({ args: exec?.arguments, policy, config: options?.config });
    if (save.kind === 'ask')
        return save;
    const where = `policy=${policy ?? 'unknown'}，saveApproval=${saveApprovalOf(options?.config)}`;
    if (save.kind === 'deny') {
        warnGate(options?.logger, `memory_save 被拒绝（${where}）：${save.reason}`);
        return save;
    }
    infoGate(options?.logger, `memory_save 免确认放行（${where}）`);
    return downstream;
}
/** 门 info 日志（统一 [dsh-my-memory] 前缀）。 */
function infoGate(logger, message) {
    logger?.info(`[dsh-my-memory] ${message}`);
}
/** 门 warn 日志（统一 [dsh-my-memory] 前缀）。 */
function warnGate(logger, message) {
    logger?.warn(`[dsh-my-memory] ${message}`);
}
