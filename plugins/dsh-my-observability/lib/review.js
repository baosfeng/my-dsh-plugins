/**
 * dsh-my-observability — incremental diff review (rule engine).
 *
 * 提交前增量 diff 审查：确定性规则引擎（纯函数，可独立测试），检查：
 *  - debug-statement   调试残留（console.* / debugger / print 族）→ warning
 *  - secret-leak       密钥/凭据硬编码（password/api_key/secret/token）→ error
 *  - conflict-marker   合并冲突标记残留（<<<<<<< / ======= / >>>>>>>）→ error
 *  - todo-marker       TODO/FIXME/HACK 标记 → info
 *  - trailing-space    新增行尾随空格 → info
 *  - large-diff        单文件变更超阈值 → warning
 *  - binary-file       二进制文件变更 → warning
 *  - no-test-change    有源码变更但无测试变更 → info
 *
 * AI 增强审查见 lib/ai.js（可选，agents 服务可用时追加 LLM 结论）。
 */
import { isTestFile, isSourceFile } from './diff.js';
/** 单文件变更行数阈值（large-diff 规则）。 */
export const LARGE_DIFF_LINES = 300;
/** 对已解析 diff 运行规则引擎，返回 { summary, issues }。 */
export function reviewRules(parsed) {
    const issues = [];
    for (const file of parsed.files) {
        for (const added of file.addedLines) {
            pushIf(issues, debugIssue(file, added));
            pushIf(issues, secretIssue(file, added));
            pushIf(issues, conflictIssue(file, added));
            pushIf(issues, todoIssue(file, added));
            pushIf(issues, trailingIssue(file, added));
        }
        pushIf(issues, largeDiffIssue(file));
        pushIf(issues, binaryIssue(file));
    }
    pushIf(issues, noTestIssue(parsed));
    return summarize(parsed, issues);
}
/** 汇总：变更统计 + 问题分级计数。 */
function summarize(parsed, issues) {
    const files = parsed.files;
    const insertions = files.reduce((sum, file) => sum + file.insertions, 0);
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
    return {
        issues,
        summary: {
            files: files.length,
            insertions,
            deletions,
            issues: issues.length,
            errors: countBy(issues, 'error'),
            warnings: countBy(issues, 'warning'),
            infos: countBy(issues, 'info'),
            binary: parsed.binary,
        },
    };
}
function countBy(issues, severity) {
    return issues.filter((issue) => issue.severity === severity).length;
}
function pushIf(issues, issue) {
    if (issue !== undefined)
        issues.push(issue);
}
/** 调试残留（console.* / debugger / print 族）。 */
function debugIssue(file, added) {
    if (!/console\.(log|debug|warn|info|error)|debugger\b|\bprint\(|println\(|System\.out\.print/.test(added.text))
        return undefined;
    return issue('warning', 'debug-statement', file, added, '调试残留语句（console/print/debugger）');
}
/** 密钥/凭据硬编码。 */
function secretIssue(file, added) {
    if (!/(password|passwd|api[_-]?key|secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][^'"]{4,}['"]/i.test(added.text))
        return undefined;
    return issue('error', 'secret-leak', file, added, '疑似硬编码密钥/凭据');
}
/** 合并冲突标记残留。 */
function conflictIssue(file, added) {
    if (!/^(<<<<<<<|=======|>>>>>>>)/.test(added.text))
        return undefined;
    return issue('error', 'conflict-marker', file, added, '合并冲突标记残留');
}
/** TODO/FIXME 标记。 */
function todoIssue(file, added) {
    if (!/\b(TODO|FIXME|HACK|XXX)\b/.test(added.text))
        return undefined;
    return issue('info', 'todo-marker', file, added, 'TODO/FIXME 标记');
}
/** 尾随空格。 */
function trailingIssue(file, added) {
    if (!/\s+$/.test(added.text))
        return undefined;
    return issue('info', 'trailing-space', file, added, '行尾多余空格');
}
/** 单文件变更超阈值。 */
function largeDiffIssue(file) {
    const changed = file.insertions + file.deletions;
    if (changed <= LARGE_DIFF_LINES || file.binary)
        return undefined;
    return issue('warning', 'large-diff', file, null, `单文件变更 ${changed} 行（>${LARGE_DIFF_LINES}），建议拆分提交`);
}
/** 二进制文件变更。 */
function binaryIssue(file) {
    if (!file.binary)
        return undefined;
    return issue('warning', 'binary-file', file, null, '二进制文件变更');
}
/** 有源码变更但无测试变更。 */
function noTestIssue(parsed) {
    const sourceFiles = parsed.files.filter((file) => isSourceFile(file.path));
    const testFiles = parsed.files.filter((file) => isTestFile(file.path));
    if (sourceFiles.length === 0 || testFiles.length > 0)
        return undefined;
    return issue('info', 'no-test-change', null, null, '有源码变更但没有测试文件变更');
}
function issue(severity, rule, file, added, message) {
    return {
        severity,
        rule,
        file: file?.path ?? '',
        line: added?.line ?? 0,
        message,
    };
}
