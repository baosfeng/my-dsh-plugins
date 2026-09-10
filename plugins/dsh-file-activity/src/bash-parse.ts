/**
 * Lightweight static parser for bash command text → file-touch intents.
 *
 * Feeds the `tools/pre-execute` observer (index.js): a bash tool call carries
 * the exact command string, and we resolve the file operations it is about to
 * perform. Conservative by design — 宁可漏报也不误报:
 *
 *  - only well-known commands with unambiguous file effects are recognized
 *    (rm → delete; touch / cp / install / tee / sed -i / `> file` → write;
 *    mv → source delete + destination write) — see bash-ops.js;
 *  - paths containing variables ($…), command substitution ($(…), `…`),
 *    globs (* ? [ {) or fd redirections (2>&1) are skipped;
 *  - unknown commands contribute nothing (only their `>` redirects count);
 *  - relative paths resolve against the base dir (workdir / session cwd),
 *    and `cd <dir>` segments update the base for the following segments.
 *
 * The returned operations are applied through the regular record pipeline
 * ('write' is classified create/modify by the known-file registry, 'delete'
 * removes the file from stats), so the view stays consistent with the disk.
 */
import { pushCommandOps, positionalArgs, resolveSafe, pushOp } from './bash-ops.js'
import type { BashOp, BashToken } from './types.js'

/** Prefix wrappers that do not touch files themselves. */
const PREFIX_CMDS = new Set(['sudo', 'nohup', 'command', 'time', 'env'])

/** Parse one bash command into [{ op: 'write'|'delete', path }] (deduped). */
export function parseBashFileOps(command: string, baseDir: string): BashOp[] {
  const ops: BashOp[] = []
  let cwd = baseDir
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment)
    const start = commandStartOf(tokens)
    if (start < 0) continue
    const cmd = basenameOf(tokens[start].text)
    const args = tokens.slice(start + 1)
    if (cmd === 'cd') {
      const target = cdTargetOf(args)
      if (target !== '') cwd = resolveSafe({ text: target, safe: true }, cwd)
      continue
    }
    pushCommandOps(ops, cmd, args, cwd)
    pushRedirectOps(ops, tokens, cwd)
  }
  return dedupeOps(ops)
}

// ── quoting pre-pass ───────────────────────────────────────────────────────

/**
 * Per-char quote state: 0 = unquoted, 1 = single-quoted, 2 = double-quoted,
 * -1 = the quote character itself (kept in segment text, stripped by
 * tokenize). Escape handling: outside quotes and inside double quotes a
 * backslash makes the next char literal; inside single quotes backslash is
 * literal (bash). The output array has one entry per input character.
 */
function quoteMarks(text: string): number[] {
  const marks: number[] = []
  let quote = 0
  let i = 0
  while (i < text.length) {
    const step = quoteStep(text, i, quote)
    marks.push(...step.marks)
    quote = step.quote
    i += step.advance
  }
  return marks
}

/** One character's quote transition: { marks, quote, advance }. */
function quoteStep(text: string, i: number, quote: number): { marks: number[]; quote: number; advance: number } {
  const ch = text[i]
  if (ch === '\\' && quote !== 1 && i + 1 < text.length) return { marks: [quote, quote], quote, advance: 2 }
  if (quote !== 0 && ch === quoteCharOf(quote)) return { marks: [-1], quote: 0, advance: 1 }
  if (quote === 0 && isQuoteChar(ch)) return { marks: [-1], quote: quoteOf(ch), advance: 1 }
  return { marks: [quote], quote, advance: 1 }
}

function quoteCharOf(quote: number): string {
  return quote === 1 ? "'" : '"'
}

function quoteOf(ch: string): number {
  return ch === "'" ? 1 : 2
}

function isQuoteChar(ch: string): boolean {
  return ch === "'" || ch === '"'
}

// ── segment splitting ──────────────────────────────────────────────────────

/**
 * Split a command on the top-level separators && || ; | & and newlines.
 * Quoted separators never split; a bare `&` (background marker) splits only
 * when followed by whitespace/end — `2>&1` stays one word.
 */
export function splitSegments(command: string): string[] {
  const marks = quoteMarks(command)
  const segments: string[] = []
  let current = ''
  for (let i = 0; i < command.length; i += 1) {
    if (marks[i] !== 0 || !isSeparator(command, i)) {
      current += command[i]
      continue
    }
    flushSegment(segments, current)
    current = ''
    i += separatorLength(command, i) - 1
  }
  flushSegment(segments, current)
  return segments
}

function isSeparator(command: string, i: number): boolean {
  const ch = command[i]
  if (ch === '&') return command[i + 1] === '&' || i + 1 >= command.length || /\s/.test(command[i + 1])
  return ch === '|' || ch === ';' || ch === '\n' || ch === '\r'
}

function separatorLength(command: string, i: number): number {
  return command[i] === '&' && command[i + 1] === '&' ? 2 : 1
}

function flushSegment(segments: string[], current: string): void {
  const trimmed = current.trim()
  if (trimmed !== '') segments.push(trimmed)
}

// ── tokenizing ─────────────────────────────────────────────────────────────

/**
 * Split one segment into words. Tokens keep their quoted content (quotes
 * stripped) and a `safe` flag: false when the word contains variables /
 * command substitution / globs — such paths must never be recorded.
 */
export function tokenize(segment: string): BashToken[] {
  const marks = quoteMarks(segment)
  const tokens: BashToken[] = []
  let current = ''
  let safe = true
  const push = (): void => {
    if (current !== '') {
      tokens.push({ text: current, safe })
      current = ''
      safe = true
    }
  }
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]
    if (marks[i] === -1) continue // quote characters are stripped
    if (marks[i] === 0 && /\s/.test(ch)) {
      push()
      continue
    }
    if (isEscape(segment, i, marks[i])) {
      current += segment[i + 1]
      i += 1
      continue
    }
    if (isUnsafeChar(ch, marks[i])) {
      safe = false
      current += ch
      continue
    }
    current += ch
  }
  push()
  return tokens
}

/** Backslash escapes the next char outside quotes and inside double quotes. */
function isEscape(segment: string, i: number, quote: number): boolean {
  if (segment[i] !== '\\' || quote === 1) return false
  return i + 1 < segment.length
}

/** `$` expands everywhere except single quotes; globs only outside quotes. */
function isUnsafeChar(ch: string, quote: number): boolean {
  if (ch === '$') return quote !== 1
  if (quote !== 0) return false
  return ch === '`' || ch === '*' || ch === '?' || ch === '[' || ch === '{'
}

// ── command head ───────────────────────────────────────────────────────────

/** Index of the first real command token (skipping VAR=x and wrappers). */
function findStartOf(tokens: BashToken[], index: number): number {
  while (index < tokens.length) {
    const token = tokens[index]
    if (isAssignment(token.text) || PREFIX_CMDS.has(basenameOf(token.text))) {
      index += 1
      continue
    }
    return index
  }
  return -1
}

function commandStartOf(tokens: BashToken[]): number {
  const start = findStartOf(tokens, 0)
  if (start < 0) return -1
  if (basenameOf(tokens[start].text) === 'env') {
    // env VAR=value cmd: assignments after env are skipped too.
    return findStartOf(tokens, start + 1)
  }
  return start
}

function isAssignment(text: string): boolean {
  const eq = text.indexOf('=')
  if (eq <= 0) return false
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(text)
}

function basenameOf(text: string): string {
  const slash = text.lastIndexOf('/')
  return slash === -1 ? text : text.slice(slash + 1)
}

// ── paths & redirects ──────────────────────────────────────────────────────

/** `> file` / `>> file` / `2> file` redirects write the target file. */
function pushRedirectOps(ops: BashOp[], tokens: BashToken[], cwd: string): void {
  for (let i = 0; i < tokens.length; i += 1) {
    const match = /^(\d*)>{1,2}(.*)$/.exec(tokens[i].text)
    if (match === null) continue
    const target = redirectTarget(tokens, i, match[2])
    if (target === null) continue
    pushOp(ops, 'write', { text: target.text, safe: target.safe }, cwd)
  }
}

/** The file a redirect writes; null when it is an fd / /dev/null / missing. */
function redirectTarget(tokens: BashToken[], i: number, inline: string): BashToken | null {
  if (inline !== '') return usable(inline, tokens[i].safe) ? { text: inline, safe: tokens[i].safe } : null
  const next = tokens[i + 1]
  if (next === undefined || !next.safe) return null
  return usable(next.text, true) ? { text: next.text, safe: true } : null
}

function usable(text: string, safe: boolean): boolean {
  if (!safe || text === '') return false
  return !text.startsWith('&') && !text.startsWith('/dev/')
}

/** `cd` target: the first positional argument ('' when missing/unsafe). */
function cdTargetOf(args: BashToken[]): string {
  const paths = positionalArgs(args)
  if (paths.length === 0) return ''
  return paths[0].safe ? paths[0].text : ''
}

/** Dedupe by op+path, keeping the first occurrence. */
function dedupeOps(ops: BashOp[]): BashOp[] {
  const seen = new Set<string>()
  return ops.filter((op) => {
    const key = `${op.op}\u0000${op.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
