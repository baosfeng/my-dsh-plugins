/**
 * dsh-my-guardian — minimal semver helpers for the dependency pre-check.
 *
 * Only the subset needed to validate peerDependency ranges is implemented:
 * parse a version, compare two versions (with prerelease precedence), and test
 * whether a version satisfies a range (`^`, `~`, comparator operators,
 * wildcards, `||` and whitespace-AND). Build metadata (`+build`) is ignored for
 * precedence. Everything is pure and dependency-free.
 */

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

interface RangeVersion {
  major: number | null
  minor: number | null
  patch: number | null
  prerelease: string[]
}

// Parse a version string into { major, minor, patch, prerelease }.
// Returns null for input that is not a usable version.
function parseVersion(input: string): ParsedVersion | null {
  if (typeof input !== 'string') return null
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input.trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

// Numeric identifiers have lower precedence than alphanumeric ones.
function compareIdentifiers(a: string, b: string): number {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Number(a) - Number(b)
  if (aNum !== bNum) return aNum ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

// Compare two prerelease arrays (a shorter list has lower precedence).
function comparePrerelease(ap: string[], bp: string[]): number {
  if (ap.length === 0 && bp.length === 0) return 0
  if (ap.length === 0) return 1
  if (bp.length === 0) return -1
  const len = Math.max(ap.length, bp.length)
  for (let i = 0; i < len; i++) {
    const ai = ap[i]
    const bi = bp[i]
    if (ai === undefined) return -1
    if (bi === undefined) return 1
    const diff = compareIdentifiers(ai, bi)
    if (diff !== 0) return diff
  }
  return 0
}

// Compare two parsed version tuples (major/minor/patch/prerelease).
// Returns negative/zero/positive like Array#sort.
function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

// Parse a range version spec that may contain wildcards (`x`/`*`) and a
// trailing prerelease (`1.2.3-rc.8`). Missing/padded components are null.
function parseRangeVersion(spec: string): RangeVersion | null {
  const match = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/.exec(spec.trim())
  if (match === null) return null
  const toNum = (value: string | undefined): number | null =>
    value !== undefined && /^\d+$/.test(value) ? Number(value) : null
  return {
    major: toNum(match[1]),
    minor: match[2] === undefined ? null : toNum(match[2]),
    patch: match[3] === undefined ? null : toNum(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

// Lower bound tuple for a caret/tilde range base (wildcards → 0).
function lowerBound(base: RangeVersion): ParsedVersion {
  return {
    major: base.major ?? 0,
    minor: base.minor ?? 0,
    patch: base.patch ?? 0,
    prerelease: base.prerelease,
  }
}

// Upper bound for a caret range: bump the first non-zero component.
function caretUpper(lo: ParsedVersion): ParsedVersion {
  if (lo.major > 0) return { major: lo.major + 1, minor: 0, patch: 0, prerelease: ['0'] }
  if (lo.minor > 0) return { major: 0, minor: lo.minor + 1, patch: 0, prerelease: ['0'] }
  if (lo.patch > 0) return { major: 0, minor: 0, patch: lo.patch + 1, prerelease: ['0'] }
  return { major: 0, minor: 1, patch: 0, prerelease: ['0'] }
}

function satisfiesCaret(version: string, spec: string): boolean {
  const base = parseRangeVersion(spec)
  const parsed = parseVersion(version)
  if (base === null || parsed === null) return false
  const lo = lowerBound(base)
  if (compareParsed(parsed, lo) < 0) return false
  return compareParsed(parsed, caretUpper(lo)) < 0
}

function satisfiesTilde(version: string, spec: string): boolean {
  const base = parseRangeVersion(spec)
  const parsed = parseVersion(version)
  if (base === null || parsed === null) return false
  const lo = lowerBound(base)
  if (compareParsed(parsed, lo) < 0) return false
  const upper =
    base.minor === null
      ? { major: lo.major + 1, minor: 0, patch: 0, prerelease: ['0'] }
      : { major: lo.major, minor: lo.minor + 1, patch: 0, prerelease: ['0'] }
  return compareParsed(parsed, upper) < 0
}

// Compare a single range component against the version; wildcard (null) skips.
function compareComponent(parsed: ParsedVersion, base: RangeVersion, key: 'major' | 'minor' | 'patch'): number {
  if (base[key] === null) return 0
  if (parsed[key] === base[key]) return 0
  return parsed[key] < (base[key] as number) ? -1 : 1
}

// Compare a version against a range spec, only over the components that are
// concrete numbers. Returns null when either side is not a usable version.
function compareRangeToVersion(version: string, spec: string): number | null {
  const base = parseRangeVersion(spec)
  const parsed = parseVersion(version)
  if (base === null || parsed === null) return null
  for (const key of ['major', 'minor', 'patch'] as const) {
    const diff = compareComponent(parsed, base, key)
    if (diff !== 0) return diff
  }
  return 0
}

function satisfiesComparator(version: string, token: string): boolean {
  const match = /^(>=|<=|>|<|=|==)?\s*(.+)$/.exec(token.trim())
  if (match === null) return false
  const op = match[1] ?? '='
  const diff = compareRangeToVersion(version, match[2].trim())
  if (diff === null) return false
  if (op === '>') return diff > 0
  if (op === '<') return diff < 0
  if (op === '>=') return diff >= 0
  if (op === '<=') return diff <= 0
  return diff === 0
}

function satisfiesExactOrWildcard(version: string, token: string): boolean {
  const base = parseRangeVersion(token)
  const parsed = parseVersion(version)
  if (base === null || parsed === null) return false
  return compareRangeToVersion(version, token) === 0
}

function satisfiesToken(version: string, token: string): boolean {
  if (token === '' || token === '*' || token === 'x' || token === 'X') return true
  if (token.startsWith('^')) return satisfiesCaret(version, token.slice(1))
  if (token.startsWith('~')) return satisfiesTilde(version, token.slice(1))
  if (/^(>=|<=|>|<|=|==)/.test(token)) return satisfiesComparator(version, token)
  return satisfiesExactOrWildcard(version, token)
}

// A single alternative group: whitespace-AND of tokens, minus hyphen ranges.
function satisfiesAll(version: string, alt: string): boolean {
  if (alt === '') return true
  const hyphen = alt.split(/\s+-\s+/)
  if (hyphen.length === 2) {
    return satisfies(version, `>=${hyphen[0].trim()}`) && satisfies(version, `<=${hyphen[1].trim()}`)
  }
  return alt
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => satisfiesToken(version, token))
}

/**
 * Test whether `version` satisfies `range` (supports `||`, whitespace-AND and
 * the common comparators). An empty or `*` range matches anything. A prerelease
 * version only matches when the range itself mentions a prerelease — mirroring
 * the semver rule that prereleases are opt-in.
 */
export function satisfies(version: string, range: string): boolean {
  if (typeof version !== 'string' || typeof range !== 'string') return false
  const trimmed = range.trim()
  if (trimmed === '' || trimmed === '*') return true
  const parsed = parseVersion(version)
  if (parsed !== null && parsed.prerelease.length > 0 && !range.includes('-')) return false
  return trimmed.split('||').some((alt) => satisfiesAll(version, alt.trim()))
}
