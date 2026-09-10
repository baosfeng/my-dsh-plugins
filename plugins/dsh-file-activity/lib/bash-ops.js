import { homedir } from 'node:os';
import { isAbsolute, join, normalize, resolve } from 'node:path';
/**
 * bash-ops.js — command → file-operation mapping for the bash intent parser
 * (see bash-parse.js for the segment/token layer).
 *
 * Conservative by design: only unambiguous commands map to ops; paths the
 * parser cannot resolve statically (option-argument pairs, `-t` relocations,
 * sed without -i, unknown commands) contribute nothing.
 */
/** Options of a command that consume the following argument (never a path). */
function optionArgsOf(cmd) {
    if (cmd === 'touch')
        return new Set(['-d', '-t', '-r', '--date', '--time', '--reference']);
    return new Set();
}
/**
 * Path arguments with options stripped: `-rf` / `--force` / `--` are skipped;
 * options listed in `optionArgs` consume their following argument too.
 *
 * `optionArgs` 可选：`cd` 的目标解析（bash-parse.js）只取第一个位置参数，
 * 不传选项表——与迁移前逐字节一致（该路径遇到 `-` 开头的 token 仍会抛错）。
 */
export function positionalArgs(args, optionArgs) {
    const paths = [];
    let afterDashDash = false;
    for (let i = 0; i < args.length; i += 1) {
        const token = args[i];
        if (!afterDashDash && token.text === '--') {
            afterDashDash = true;
            continue;
        }
        if (!afterDashDash && token.text.startsWith('-') && token.text !== '-') {
            if (optionArgs.has(token.text))
                i += 1;
            continue;
        }
        paths.push(token);
    }
    return paths;
}
/**
 * -t / --target-directory variants (cp/mv/install) relocate sources into a
 * directory; statically resolving the real destination is unreliable, so the
 * whole segment is skipped (conservative: never record a wrong path).
 */
function hasTargetDirOption(cmd, args) {
    if (cmd !== 'mv' && cmd !== 'cp' && cmd !== 'install')
        return false;
    return args.some((token) => token.text === '-t' || token.text === '--target-directory');
}
/** Dispatch one segment's command to the matching file-op mapping. */
export function pushCommandOps(ops, cmd, args, cwd) {
    if (hasTargetDirOption(cmd, args))
        return;
    const optionArgs = optionArgsOf(cmd);
    const paths = positionalArgs(args, optionArgs);
    if (cmd === 'rm')
        return pushAll(ops, 'delete', paths, cwd);
    if (cmd === 'touch' || cmd === 'tee')
        return pushAll(ops, 'write', paths, cwd);
    if (cmd === 'mv')
        return pushMv(ops, paths, cwd);
    if (cmd === 'cp' || cmd === 'install')
        return pushLast(ops, paths, cwd);
    if (cmd === 'sed' && hasInPlace(args))
        pushLast(ops, positionalArgs(args, optionArgs), cwd);
}
/** All positional paths get the same op (rm / touch / tee). */
function pushAll(ops, op, paths, cwd) {
    for (const token of paths)
        pushOp(ops, op, token, cwd);
}
/** Only the last path is the write destination (cp / install). */
function pushLast(ops, paths, cwd) {
    if (paths.length === 0)
        return;
    pushOp(ops, 'write', paths[paths.length - 1], cwd);
}
/** mv: all but the last are sources (delete), the last is the destination. */
function pushMv(ops, paths, cwd) {
    if (paths.length === 0)
        return;
    for (let i = 0; i < paths.length - 1; i += 1)
        pushOp(ops, 'delete', paths[i], cwd);
    pushOp(ops, 'write', paths[paths.length - 1], cwd);
}
/** sed writes files only with -i / --in-place (also -i.bak style). */
function hasInPlace(args) {
    return args.some((token) => /^-i($|[A-Za-z0-9_.])/.test(token.text) || token.text === '--in-place');
}
export function pushOp(ops, op, token, cwd) {
    const path = resolveSafe(token, cwd);
    if (path !== '')
        ops.push({ op, path });
}
/** Resolve a token to an absolute path; '' when unsafe or unusable. */
export function resolveSafe(token, cwd) {
    if (!token.safe || token.text === '')
        return '';
    let path = token.text;
    if (path === '~')
        return homedir();
    if (path.startsWith('~/'))
        path = join(homedir(), path.slice(2));
    if (path.includes('\0'))
        return '';
    const abs = isAbsolute(path) ? normalize(path) : resolve(cwd, path);
    return normalize(abs);
}
