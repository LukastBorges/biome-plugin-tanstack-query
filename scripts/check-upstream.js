#!/usr/bin/env node
// Detects new releases of the upstream ESLint plugin this repository mirrors
// (`package.json#upstream`) and opens a GitHub issue describing what changed.
//
// What it does:
//   1. Reads the mirrored version from package.json (`upstream.version`).
//   2. Fetches the full npm packument and compares `dist-tags.latest` against it
//      with a SemVer 2.0.0 compliant comparator.
//   3. When a newer version exists, downloads the tarballs of BOTH versions,
//      verifies their `dist.integrity` (SRI), gunzips and parses the tar archives
//      in memory and diffs them: new / removed rules, rules whose source files
//      changed (sha256 per file), shared source changes, and changes to the
//      `recommended` / `recommended-strict` configs.
//   4. Renders a Markdown issue (with a maintainer checklist and port status of
//      this repository) and opens it via the GitHub REST API, unless an issue
//      with the same title already exists (open or closed).
//
// Zero dependencies; Node >= 20 (global fetch, node:zlib, node:crypto).
//
// Usage:
//   node scripts/check-upstream.js [--dry-run] [--json] [--fail-on-update] [--current <version>]
//
//   --dry-run          Print the issue instead of calling the GitHub API (npm is still queried).
//   --json             Print a machine-readable report on stdout (logs go to stderr).
//   --fail-on-update   Exit with code 2 when a newer upstream version exists.
//   --current <ver>    Pretend this repository mirrors <ver> (testing aid, requires --dry-run).
//                      Also: $UPSTREAM_CURRENT_VERSION.
//
// Environment (non dry-run): GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo), optional GITHUB_API_URL.
// $GITHUB_STEP_SUMMARY, when set, receives a Markdown job summary.
//
// Exit codes: 0 up to date / issue handled, 1 error, 2 update available with --fail-on-update.

import { createHash, timingSafeEqual } from 'node:crypto'
import { appendFileSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs as parseNodeArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'
import { GENERATED_FILES, PRESETS } from './build-index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const NPM_REGISTRY = 'https://registry.npmjs.org'
export const UPSTREAM_GITHUB_REPO = 'TanStack/query'
export const UPSTREAM_PACKAGE_DIR = 'packages/eslint-plugin-query'
export const RULE_PREFIX = '@tanstack/query/'
export const ISSUE_LABEL = Object.freeze({
  name: 'upstream-sync',
  color: '1d76db',
  description: 'A new upstream @tanstack/eslint-plugin-query release needs to be ported',
})
export const USER_AGENT =
  'biome-plugin-tanstack-query/check-upstream (+https://github.com/LukastBorges/biome-plugin-tanstack-query)'
/** Hard caps for downloaded archives (defense against hostile/huge payloads). */
export const MAX_TARBALL_BYTES = 50 * 1024 * 1024
export const MAX_UNPACKED_BYTES = 200 * 1024 * 1024
/** GitHub rejects issue bodies above 65536 characters. */
export const MAX_ISSUE_BODY = 65_000

/**
 * @typedef {{ major: string, minor: string, patch: string, prerelease: string[], build: string[], raw: string }} SemVer
 * @typedef {'error' | 'warn' | 'off'} Severity
 * @typedef {Record<string, Severity>} RuleMap
 * @typedef {Record<string, RuleMap>} ConfigMaps  Keys: 'recommended', 'recommended-strict'.
 * @typedef {{
 *   version: string,
 *   ruleSource: 'src' | 'build' | 'none',
 *   rules: Record<string, Record<string, string>>,
 *   shared: Record<string, string>,
 *   configs: ConfigMaps,
 * }} Snapshot  `rules` maps rule name -> (file path -> sha256); `shared` maps non-rule src files -> sha256.
 * @typedef {{ path: string, status: 'added' | 'removed' | 'modified' }} FileChange
 * @typedef {{ preset: string, rule: string, from: Severity | null, to: Severity | null }} ConfigChange
 * @typedef {{
 *   newRules: string[],
 *   removedRules: string[],
 *   changedRules: { rule: string, files: FileChange[] }[],
 *   unchangedRules: string[],
 *   sharedChanges: FileChange[],
 *   configChanges: ConfigChange[],
 *   newPresets: string[],
 *   removedPresets: string[],
 *   sourcesComparable: boolean,
 *   configsComparable: boolean,
 * }} SnapshotDiff
 * @typedef {{ name: string, severities: string[] }} LocalRule
 * @typedef {{
 *   localRules: string[],
 *   notPorted: string[],
 *   notUpstream: string[],
 *   presetDrift: { preset: string, missing: string[], extra: string[] }[],
 *   severityDrift: { rule: string, local: string[], upstream: Severity }[],
 * }} PortStatus
 * @typedef {{
 *   packageName: string,
 *   current: string,
 *   latest: string,
 *   currentPublishedAt: string | null,
 *   latestPublishedAt: string | null,
 *   intermediateVersions: string[],
 *   diff: SnapshotDiff,
 *   latestRules: string[],
 *   latestConfigs: ConfigMaps,
 *   port: PortStatus,
 *   runUrl?: string | null,
 *   supersedes?: { number: number, title: string, html_url?: string }[],
 * }} UpdateReport
 * @typedef {{ number: number, title: string, state?: string, html_url?: string, pull_request?: unknown }} GitHubIssue
 * @typedef {typeof globalThis.fetch} FetchLike
 */

// ---------------------------------------------------------------------------
// SemVer
// ---------------------------------------------------------------------------

const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/**
 * Parses a SemVer 2.0.0 version (a leading `v` is tolerated). Numeric parts are
 * kept as strings so arbitrarily large numbers compare correctly.
 * @param {string} version
 * @returns {SemVer}
 */
export function parseSemver(version) {
  const match = typeof version === 'string' ? SEMVER_RE.exec(version.trim()) : null
  if (!match) throw new TypeError(`Invalid semantic version: ${JSON.stringify(version)}`)
  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
    raw: version.trim(),
  }
}

/** @param {string} version */
export function isValidSemver(version) {
  return typeof version === 'string' && SEMVER_RE.test(version.trim())
}

/**
 * Compares two canonical (no leading zeros) non-negative integer strings.
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
function compareNumeric(a, b) {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * SemVer 2.0.0 precedence: -1 if a < b, 0 if equal, 1 if a > b. Build metadata
 * is ignored; a pre-release sorts before its release; pre-release identifiers
 * compare numerically when numeric, numeric < alphanumeric, and a shorter set of
 * identifiers sorts first when all preceding identifiers are equal.
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
export function compareSemver(a, b) {
  const x = parseSemver(a)
  const y = parseSemver(b)
  for (const key of /** @type {const} */ (['major', 'minor', 'patch'])) {
    const cmp = compareNumeric(x[key], y[key])
    if (cmp !== 0) return cmp
  }
  if (!x.prerelease.length && !y.prerelease.length) return 0
  if (!x.prerelease.length) return 1
  if (!y.prerelease.length) return -1
  const length = Math.max(x.prerelease.length, y.prerelease.length)
  for (let i = 0; i < length; i++) {
    const p = x.prerelease[i]
    const q = y.prerelease[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pNum = /^\d+$/.test(p)
    const qNum = /^\d+$/.test(q)
    if (pNum && qNum) return compareNumeric(p, q)
    if (pNum) return -1
    if (qNum) return 1
    return p < q ? -1 : 1
  }
  return 0
}

/** @param {string} version */
export function isPrerelease(version) {
  return parseSemver(version).prerelease.length > 0
}

/**
 * Stable versions strictly between `from` and `to` (inclusive of `to`), sorted ascending.
 * @param {string[]} versions
 * @param {string} from
 * @param {string} to
 */
export function versionsBetween(versions, from, to) {
  return versions
    .filter((v) => isValidSemver(v) && !isPrerelease(v))
    .filter((v) => compareSemver(v, from) > 0 && compareSemver(v, to) <= 0)
    .sort(compareSemver)
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * fetch() with timeout and exponential backoff. Retries network errors, timeouts,
 * HTTP 429 and 5xx — but only for idempotent methods (GET/HEAD), so a POST is
 * never replayed. Non-retryable responses are returned to the caller as-is.
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{ retries?: number, baseDelayMs?: number, timeoutMs?: number, fetchImpl?: FetchLike, sleep?: (ms: number) => Promise<unknown> }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, init = {}, options = {}) {
  const {
    retries = 3,
    baseDelayMs = 500,
    timeoutMs = 30_000,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
  } = options
  const method = (init.method ?? 'GET').toUpperCase()
  const maxAttempts = method === 'GET' || method === 'HEAD' ? retries + 1 : 1
  /** @type {unknown} */
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) })
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === maxAttempts) return response
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`.trim())
      await response.body?.cancel().catch(() => {})
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts) break
    }
    const delay = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * baseDelayMs)
    log(
      `  request to ${url} failed (${errorMessage(lastError)}); retrying in ${delay}ms [${attempt}/${maxAttempts - 1}]`,
    )
    await sleep(delay)
  }
  throw new Error(`${method} ${url} failed after ${maxAttempts} attempt(s): ${errorMessage(lastError)}`, {
    cause: lastError,
  })
}

/** @param {unknown} error */
function errorMessage(error) {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : ''
    return `${error.message}${cause}`
  }
  return String(error)
}

// ---------------------------------------------------------------------------
// npm registry
// ---------------------------------------------------------------------------

/**
 * `@scope/name` -> `@scope%2Fname` (the form the registry expects).
 * @param {string} name
 */
export function encodePackageName(name) {
  return name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name)
}

/**
 * Fetches the FULL packument (the abbreviated `application/vnd.npm.install-v1+json`
 * document has no `time` field).
 * @param {string} packageName
 * @param {{ fetchImpl?: FetchLike, registry?: string, sleep?: (ms: number) => Promise<unknown> }} [options]
 * @returns {Promise<any>}
 */
export async function fetchPackument(packageName, options = {}) {
  const { fetchImpl, registry = NPM_REGISTRY, sleep } = options
  const url = `${registry}/${encodePackageName(packageName)}`
  const response = await fetchWithRetry(
    url,
    { headers: { accept: 'application/json', 'user-agent': USER_AGENT } },
    { fetchImpl, sleep },
  )
  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status} for ${url}`)
  }
  const packument = await response.json()
  if (!packument || typeof packument !== 'object' || !packument['dist-tags'] || !packument.versions) {
    throw new Error(`Unexpected packument shape from ${url}`)
  }
  return packument
}

/**
 * @param {any} packument
 * @param {string} version
 * @returns {{ version: string, tarball: string, integrity: string | null, shasum: string | null, publishedAt: string | null }}
 */
export function resolveVersionInfo(packument, version) {
  const manifest = packument.versions?.[version]
  if (!manifest) {
    throw new Error(`Version ${version} of ${packument.name ?? 'the package'} does not exist on the npm registry`)
  }
  if (!manifest.dist?.tarball) throw new Error(`Version ${version} has no dist.tarball in the packument`)
  return {
    version,
    tarball: manifest.dist.tarball,
    integrity: manifest.dist.integrity ?? null,
    shasum: manifest.dist.shasum ?? null,
    publishedAt: packument.time?.[version] ?? null,
  }
}

export class IntegrityError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'IntegrityError'
  }
}

const SRI_ALGORITHMS = /** @type {const} */ (['sha512', 'sha384', 'sha256'])

/**
 * Verifies `data` against an SRI string (`dist.integrity`, possibly several
 * space-separated hashes) — per the SRI spec only the strongest algorithm
 * present is considered and any of its digests may match. Falls back to the
 * legacy sha1 hex `dist.shasum` when no supported SRI hash is available.
 * @param {Uint8Array} data
 * @param {string | null | undefined} integrity
 * @param {string | null | undefined} [shasum]
 * @returns {string} the algorithm that was verified
 */
export function verifyIntegrity(data, integrity, shasum) {
  /** @type {Map<string, string[]>} */
  const byAlgorithm = new Map()
  for (const token of (integrity ?? '').trim().split(/\s+/)) {
    const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})(?:\?.*)?$/.exec(token)
    if (!match) continue
    byAlgorithm.set(match[1], [...(byAlgorithm.get(match[1]) ?? []), match[2]])
  }
  const algorithm = SRI_ALGORITHMS.find((alg) => byAlgorithm.has(alg))
  if (algorithm) {
    const actual = createHash(algorithm).update(data).digest()
    const ok = (byAlgorithm.get(algorithm) ?? []).some((expected) => {
      const buffer = Buffer.from(expected, 'base64')
      return buffer.length === actual.length && timingSafeEqual(buffer, actual)
    })
    if (!ok) {
      throw new IntegrityError(
        `Integrity check failed: expected ${algorithm}-${byAlgorithm.get(algorithm)?.[0]}, got ${algorithm}-${actual.toString('base64')}`,
      )
    }
    return algorithm
  }
  if (shasum && /^[0-9a-f]{40}$/i.test(shasum)) {
    const actual = createHash('sha1').update(data).digest('hex')
    if (actual !== shasum.toLowerCase()) {
      throw new IntegrityError(`Integrity check failed: expected sha1 ${shasum}, got ${actual}`)
    }
    return 'sha1'
  }
  throw new IntegrityError('No usable integrity information (dist.integrity / dist.shasum) to verify the tarball')
}

/**
 * Downloads a version's tarball and verifies it before returning the bytes.
 * @param {{ tarball: string, integrity: string | null, shasum: string | null, version: string }} info
 * @param {{ fetchImpl?: FetchLike, sleep?: (ms: number) => Promise<unknown> }} [options]
 * @returns {Promise<Buffer>}
 */
export async function downloadTarball(info, options = {}) {
  const response = await fetchWithRetry(
    info.tarball,
    { headers: { accept: 'application/octet-stream', 'user-agent': USER_AGENT } },
    options,
  )
  if (!response.ok) throw new Error(`Downloading ${info.tarball} failed with HTTP ${response.status}`)
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MAX_TARBALL_BYTES) throw new Error(`Tarball ${info.tarball} is too large (${declared} bytes)`)
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length > MAX_TARBALL_BYTES) throw new Error(`Tarball ${info.tarball} is too large (${data.length} bytes)`)
  verifyIntegrity(data, info.integrity, info.shasum)
  return data
}

// ---------------------------------------------------------------------------
// tar (ustar + pax + GNU long names), in memory
// ---------------------------------------------------------------------------

const BLOCK = 512

/**
 * @param {Buffer} buf
 * @param {number} start
 * @param {number} length
 */
function readCString(buf, start, length) {
  const slice = buf.subarray(start, start + length)
  const nul = slice.indexOf(0)
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString('utf8')
}

/**
 * Reads a numeric header field: octal text, or GNU base-256 when the high bit is set.
 * @param {Buffer} buf
 * @param {number} start
 * @param {number} length
 */
function readNumber(buf, start, length) {
  const field = buf.subarray(start, start + length)
  if (field[0] & 0x80) {
    let value = field[0] & 0x7f
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i]
    return value
  }
  const text = field
    .toString('latin1')
    .replace(/[\0 ]+$/g, '')
    .trim()
  if (text === '') return 0
  if (!/^[0-7]+$/.test(text)) throw new Error(`Corrupt tar header: invalid octal field ${JSON.stringify(text)}`)
  return Number.parseInt(text, 8)
}

/**
 * Parses pax extended header records (`"<len> <key>=<value>\n"`, len in bytes).
 * @param {Buffer} data
 * @returns {Record<string, string>}
 */
export function parsePaxHeaders(data) {
  /** @type {Record<string, string>} */
  const records = {}
  let offset = 0
  while (offset < data.length) {
    if (data[offset] === 0) break
    const space = data.indexOf(0x20, offset)
    if (space === -1) throw new Error('Corrupt pax header: missing record length')
    const length = Number.parseInt(data.subarray(offset, space).toString('latin1'), 10)
    if (!Number.isInteger(length) || length <= space - offset || offset + length > data.length) {
      throw new Error('Corrupt pax header: invalid record length')
    }
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8') // drop trailing "\n"
    const eq = record.indexOf('=')
    if (eq > 0) records[record.slice(0, eq)] = record.slice(eq + 1)
    offset += length
  }
  return records
}

/** @param {string} path */
function normalizeTarPath(path) {
  return path.replace(/\\/g, '/').replace(/^(?:\.?\/)+/, '')
}

/**
 * Minimal tar reader: returns regular files (path -> contents). Handles POSIX
 * ustar (`prefix` field), pax extended headers (`x`, and `g` globals) for
 * `path`/`size`, GNU long names (`L`), base-256 sizes, and validates header
 * checksums. Directories, links and devices are skipped.
 * @param {Buffer} buffer an uncompressed tar archive
 * @returns {Map<string, Buffer>}
 */
export function parseTar(buffer) {
  /** @type {Map<string, Buffer>} */
  const files = new Map()
  /** @type {Record<string, string>} */
  let globalPax = {}
  /** @type {Record<string, string>} */
  let nextPax = {}
  /** @type {string | null} */
  let nextLongName = null
  let offset = 0

  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK)
    if (header.every((byte) => byte === 0)) break // end-of-archive marker

    const storedChecksum = readNumber(header, 148, 8)
    let checksum = 0
    for (let i = 0; i < BLOCK; i++) checksum += i >= 148 && i < 156 ? 0x20 : header[i]
    if (checksum !== storedChecksum) {
      throw new Error(`Corrupt tar archive: header checksum mismatch at offset ${offset}`)
    }

    const type = String.fromCharCode(header[156] || 0x30) // NUL means regular file
    const magic = header.subarray(257, 263).toString('latin1')
    let name = readCString(header, 0, 100)
    if (magic === 'ustar\0') {
      const prefix = readCString(header, 345, 155)
      if (prefix) name = `${prefix}/${name}`
    }
    const pax = { ...globalPax, ...nextPax }
    const size = pax.size !== undefined ? Number(pax.size) : readNumber(header, 124, 12)
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error(`Corrupt tar archive: invalid size at offset ${offset}`)
    const dataStart = offset + BLOCK
    const dataEnd = dataStart + size
    if (dataEnd > buffer.length) throw new Error(`Corrupt tar archive: entry ${JSON.stringify(name)} is truncated`)
    const data = buffer.subarray(dataStart, dataEnd)
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK

    if (type === 'x') {
      nextPax = parsePaxHeaders(data)
      continue
    }
    if (type === 'g') {
      globalPax = { ...globalPax, ...parsePaxHeaders(data) }
      continue
    }
    if (type === 'L') {
      nextLongName = readCString(data, 0, data.length)
      continue
    }
    if (type === 'K') continue // GNU long link name: irrelevant for regular files

    const path = normalizeTarPath(pax.path ?? nextLongName ?? name)
    nextPax = {}
    nextLongName = null
    if (type === '0' || type === '7') files.set(path, Buffer.from(data))
  }
  return files
}

/**
 * gunzips + untars an npm tarball and strips the top-level directory (usually
 * `package/`), so paths look like `src/rules/<rule>/<rule>.rule.ts`.
 * @param {Buffer} tgz
 * @returns {Map<string, Buffer>}
 */
export function readPackageTarball(tgz) {
  const tar = gunzipSync(tgz, { maxOutputLength: MAX_UNPACKED_BYTES })
  /** @type {Map<string, Buffer>} */
  const files = new Map()
  for (const [path, data] of parseTar(tar)) {
    const slash = path.indexOf('/')
    if (slash === -1) continue
    files.set(path.slice(slash + 1), data)
  }
  return files
}

// ---------------------------------------------------------------------------
// Upstream package analysis
// ---------------------------------------------------------------------------

/** @param {Uint8Array} data */
export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** @param {string} path */
const isTestFile = (path) => /(^|\/)__tests__\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
/** @param {string} path */
const isSourceFile = (path) => /\.[cm]?[jt]sx?$/.test(path) && !path.endsWith('.d.ts') && !isTestFile(path)

/**
 * Extracts upstream rules and per-file hashes from an unpacked package.
 * Primary source: `src/rules/<rule>/<rule>.rule.ts` (also the older flat layout
 * `src/rules/<rule>.rule.ts`). Fallback when `src/` is not shipped: built files
 * (`<dist|build|lib>/**\/rules/<rule>/<rule>.*`, incl. `.d.ts`), bundler region comments
 * (`//#region src/rules/<rule>/<rule>.rule.ts`) or `const name = "<rule>"` in
 * the bundled rules registry. Built files are not hashed (bundler churn would
 * flag every rule as changed).
 * @param {Map<string, Buffer>} files
 * @returns {{ ruleSource: Snapshot['ruleSource'], rules: Snapshot['rules'], shared: Snapshot['shared'] }}
 */
export function extractRules(files) {
  /** @type {Snapshot['rules']} */
  const rules = {}
  /** @type {Snapshot['shared']} */
  const shared = {}
  const paths = [...files.keys()].sort()

  for (const path of paths) {
    const nested = /^src\/rules\/([a-z0-9-]+)\/\1\.rule\.[cm]?[jt]s$/.exec(path)
    const flat = /^src\/rules\/([a-z0-9-]+)\.rule\.[cm]?[jt]s$/.exec(path)
    const rule = nested?.[1] ?? flat?.[1]
    if (rule) rules[rule] = {}
  }

  if (Object.keys(rules).length > 0) {
    for (const path of paths) {
      if (!path.startsWith('src/') || !isSourceFile(path)) continue
      const nested = /^src\/rules\/([a-z0-9-]+)\//.exec(path)
      const flat = /^src\/rules\/([a-z0-9-]+)\.[^/]+$/.exec(path)
      const owner = nested && rules[nested[1]] ? nested[1] : flat && rules[flat[1]] ? flat[1] : null
      const digest = sha256(/** @type {Buffer} */ (files.get(path)))
      if (owner) rules[owner][path] = digest
      else shared[path] = digest
    }
    return { ruleSource: 'src', rules, shared }
  }

  const names = new Set()
  for (const path of paths) {
    // `<dist|build|lib>/**/rules/<rule>/<rule>.<anything>` (JS or .d.ts), tests excluded.
    const built = /^(?:dist|build|lib)\/(?:.+\/)?rules\/([a-z0-9-]+)\/\1\.[^/]+$/.exec(path)
    if (built && !isTestFile(path)) names.add(built[1])
  }
  if (names.size === 0) {
    for (const path of paths) {
      if (!/^(?:dist|build|lib)\/.+\.[cm]?js$/.test(path)) continue
      const text = /** @type {Buffer} */ (files.get(path)).toString('utf8')
      for (const m of text.matchAll(/\/\/#region src\/rules\/([a-z0-9-]+)\/\1\.rule\.ts/g)) names.add(m[1])
      if (/\brules\b/.test(text)) {
        for (const m of text.matchAll(/\bconst name(?:\$\d+)?\s*=\s*["']([a-z][a-z0-9-]*)["']/g)) names.add(m[1])
      }
    }
  }
  for (const name of [...names].sort()) rules[name] = {}
  return { ruleSource: names.size > 0 ? 'build' : 'none', rules, shared }
}

/**
 * Index of the bracket that closes the one at `open`, skipping strings,
 * template literals and comments. Returns -1 when unbalanced.
 * @param {string} source
 * @param {number} open
 */
export function findClosingBracket(source, open) {
  /** @type {Record<string, string>} */
  const pairs = { '{': '}', '[': ']', '(': ')' }
  const stack = [pairs[source[open]]]
  if (!stack[0]) return -1
  for (let i = open + 1; i < source.length; i++) {
    const ch = source[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < source.length && source[i] !== ch; i++) if (source[i] === '\\') i++
    } else if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 1
    } else if (pairs[ch]) {
      stack.push(pairs[ch])
    } else if (ch === stack[stack.length - 1]) {
      stack.pop()
      if (stack.length === 0) return i
    }
  }
  return -1
}

/**
 * @param {string} value
 * @returns {Severity}
 */
function toSeverity(value) {
  if (value === '2' || value === 'error') return 'error'
  if (value === '1' || value === 'warn') return 'warn'
  return 'off'
}

const RULE_ENTRY_SOURCE = `(?<q>['"])${RULE_PREFIX.replace(/\//g, '\\/')}(?<rule>[\\w-]+)\\k<q>\\s*:\\s*(?:\\[\\s*)?(?:(?<sq>['"])(?<sev>error|warn|off)\\k<sq>|(?<num>[012])\\b)`
const SPREAD_SOURCE = String.raw`\.\.\.\s*(?<spread>[A-Za-z_$][\w$]*)`

/**
 * Parses the body of an ESLint rules object literal, resolving `...spread`s
 * of previously parsed named maps. Later keys override earlier ones.
 * @param {string} body
 * @param {Map<string, RuleMap>} [named]
 * @returns {RuleMap}
 */
export function parseRuleMap(body, named = new Map()) {
  /** @type {RuleMap} */
  const map = {}
  const re = new RegExp(`${SPREAD_SOURCE}|${RULE_ENTRY_SOURCE}`, 'g')
  for (const m of body.matchAll(re)) {
    const groups = m.groups ?? {}
    if (groups.spread) Object.assign(map, named.get(groups.spread) ?? {})
    else map[groups.rule] = toSeverity(groups.sev ?? groups.num)
  }
  return map
}

/**
 * Best-effort extraction of the `recommended` / `recommended-strict` configs
 * from upstream's `src/index.ts` (or a built `index.js`). Understands rule maps
 * declared inline under `configs` and maps hoisted into `const` declarations
 * (with spreads), for both legacy (`recommended`, `recommendedStrict`) and flat
 * (`flat/recommended`, `flat/recommended-strict`) keys; the first found wins.
 * @param {string} source
 * @returns {ConfigMaps}
 */
export function parseConfigs(source) {
  /** @type {Map<string, RuleMap>} */
  const named = new Map()
  for (const m of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*\{/g)) {
    const open = (m.index ?? 0) + m[0].length - 1
    const close = findClosingBracket(source, open)
    if (close === -1) continue
    const body = source.slice(open + 1, close)
    if (body.includes(RULE_PREFIX) || /\.\.\./.test(body)) {
      const map = parseRuleMap(body, named)
      if (Object.keys(map).length > 0) named.set(m[1], map)
    }
  }

  /** @type {Record<string, string>} */
  const presetNames = {
    recommended: 'recommended',
    'flat/recommended': 'recommended',
    recommendedStrict: 'recommended-strict',
    'recommended-strict': 'recommended-strict',
    'flat/recommended-strict': 'recommended-strict',
  }
  /** @type {ConfigMaps} */
  const configs = {}
  const keyRe =
    /(?<=[\s{,])(['"]?)(flat\/recommended-strict|flat\/recommended|recommended-strict|recommendedStrict|recommended)\1\s*:\s*/g
  for (const m of source.matchAll(keyRe)) {
    const preset = presetNames[m[2]]
    if (configs[preset]) continue
    const start = (m.index ?? 0) + m[0].length
    if (source[start] !== '{' && source[start] !== '[') continue
    const end = findClosingBracket(source, start)
    if (end === -1) continue
    const segment = source.slice(start, end + 1)
    const rulesKey = /\brules\s*:\s*/.exec(segment)
    if (!rulesKey) continue
    const valueStart = rulesKey.index + rulesKey[0].length
    /** @type {RuleMap | undefined} */
    let map
    if (segment[valueStart] === '{') {
      const valueEnd = findClosingBracket(segment, valueStart)
      if (valueEnd !== -1) map = parseRuleMap(segment.slice(valueStart + 1, valueEnd), named)
    } else {
      const ident = /^[A-Za-z_$][\w$]*/.exec(segment.slice(valueStart))
      if (ident) map = named.get(ident[0])
    }
    if (map && Object.keys(map).length > 0) configs[preset] = { ...map }
  }
  return configs
}

/**
 * @param {Map<string, Buffer>} files
 * @returns {ConfigMaps}
 */
export function extractConfigs(files) {
  const candidates = [
    'src/index.ts',
    'src/configs.ts',
    'src/configs/index.ts',
    ...[...files.keys()].filter((p) => /^(?:dist|build|lib)\/(?:.+\/)?index\.[cm]?js$/.test(p)).sort(),
  ]
  for (const path of candidates) {
    const data = files.get(path)
    if (!data) continue
    const configs = parseConfigs(data.toString('utf8'))
    if (Object.keys(configs).length > 0) return configs
  }
  return {}
}

/**
 * @param {string} version
 * @param {Map<string, Buffer>} files
 * @returns {Snapshot}
 */
export function snapshotPackage(version, files) {
  return { version, ...extractRules(files), configs: extractConfigs(files) }
}

/**
 * @param {Record<string, string>} before
 * @param {Record<string, string>} after
 * @returns {FileChange[]}
 */
function diffFiles(before, after) {
  /** @type {FileChange[]} */
  const changes = []
  for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!(path in before)) changes.push({ path, status: 'added' })
    else if (!(path in after)) changes.push({ path, status: 'removed' })
    else if (before[path] !== after[path]) changes.push({ path, status: 'modified' })
  }
  return changes
}

/**
 * @param {Snapshot} current
 * @param {Snapshot} latest
 * @returns {SnapshotDiff}
 */
export function diffSnapshots(current, latest) {
  const currentRules = new Set(Object.keys(current.rules))
  const latestRules = new Set(Object.keys(latest.rules))
  const sourcesComparable = current.ruleSource === 'src' && latest.ruleSource === 'src'

  /** @type {SnapshotDiff['changedRules']} */
  const changedRules = []
  /** @type {string[]} */
  const unchangedRules = []
  for (const rule of [...latestRules].filter((r) => currentRules.has(r)).sort()) {
    const files = sourcesComparable ? diffFiles(current.rules[rule], latest.rules[rule]) : []
    if (files.length > 0) changedRules.push({ rule, files })
    else unchangedRules.push(rule)
  }

  const currentHasConfigs = Object.keys(current.configs).length > 0
  const latestHasConfigs = Object.keys(latest.configs).length > 0
  /** @type {ConfigChange[]} */
  const configChanges = []
  for (const preset of [...new Set([...Object.keys(current.configs), ...Object.keys(latest.configs)])].sort()) {
    const before = current.configs[preset] ?? {}
    const after = latest.configs[preset] ?? {}
    for (const rule of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const from = before[rule] ?? null
      const to = after[rule] ?? null
      if (from !== to) configChanges.push({ preset, rule, from, to })
    }
  }

  return {
    newRules: [...latestRules].filter((r) => !currentRules.has(r)).sort(),
    removedRules: [...currentRules].filter((r) => !latestRules.has(r)).sort(),
    changedRules,
    unchangedRules,
    sharedChanges: sourcesComparable ? diffFiles(current.shared, latest.shared) : [],
    configChanges,
    // Only meaningful when both versions yielded configs (otherwise extraction simply failed).
    newPresets: currentHasConfigs
      ? Object.keys(latest.configs)
          .filter((p) => !(p in current.configs))
          .sort()
      : [],
    removedPresets: latestHasConfigs
      ? Object.keys(current.configs)
          .filter((p) => !(p in latest.configs))
          .sort()
      : [],
    sourcesComparable,
    configsComparable: currentHasConfigs && latestHasConfigs,
  }
}

// ---------------------------------------------------------------------------
// This repository
// ---------------------------------------------------------------------------

/**
 * @param {string} [root]
 * @returns {{ name: string, upstream: { package: string, version: string } }}
 */
export function readPackageJson(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (!pkg.upstream?.package || !pkg.upstream?.version) {
    throw new Error('package.json is missing "upstream": { "package": ..., "version": ... }')
  }
  if (!isValidSemver(pkg.upstream.version)) {
    throw new Error(`package.json#upstream.version is not a valid version: ${pkg.upstream.version}`)
  }
  return pkg
}

/**
 * Standalone rule files in `rules/` (generated presets excluded), with the
 * severities they register.
 * @param {string} [rulesDir]
 * @returns {LocalRule[]}
 */
export function readLocalRules(rulesDir = join(ROOT, 'rules')) {
  const generated = new Set(GENERATED_FILES)
  return readdirSync(rulesDir)
    .filter((file) => file.endsWith('.grit') && !generated.has(file))
    .sort()
    .map((file) => {
      const source = readFileSync(join(rulesDir, file), 'utf8')
      const severities = [...new Set([...source.matchAll(/\bseverity\s*=\s*"(\w+)"/g)].map((m) => m[1]))].sort()
      return { name: basename(file, '.grit'), severities }
    })
}

/**
 * @param {string[]} latestRules
 * @param {ConfigMaps} latestConfigs
 * @param {LocalRule[]} localRules
 * @param {Record<string, { rules: string[] }>} [presets] scripts/build-index.js PRESETS
 * @returns {PortStatus}
 */
export function computePortStatus(latestRules, latestConfigs, localRules, presets = PRESETS) {
  const local = new Set(localRules.map((r) => r.name))
  const upstream = new Set(latestRules)

  /** @type {Record<string, string>} local preset file -> upstream config name */
  const presetToConfig = { index: 'recommended', 'recommended-strict': 'recommended-strict' }
  /** @type {PortStatus['presetDrift']} */
  const presetDrift = []
  for (const [preset, { rules }] of Object.entries(presets)) {
    const config = latestConfigs[presetToConfig[preset] ?? preset]
    if (!config) continue
    const wanted = Object.keys(config).filter((rule) => config[rule] !== 'off')
    const missing = wanted.filter((rule) => !rules.includes(rule)).sort()
    const extra = rules.filter((rule) => !wanted.includes(rule)).sort()
    if (missing.length || extra.length) presetDrift.push({ preset: `${preset}.grit`, missing, extra })
  }

  /** @type {PortStatus['severityDrift']} */
  const severityDrift = []
  for (const rule of localRules) {
    const upstreamSeverity = latestConfigs.recommended?.[rule.name] ?? latestConfigs['recommended-strict']?.[rule.name]
    if (!upstreamSeverity || upstreamSeverity === 'off' || rule.severities.length === 0) continue
    if (rule.severities.some((s) => s !== upstreamSeverity)) {
      severityDrift.push({ rule: rule.name, local: rule.severities, upstream: upstreamSeverity })
    }
  }

  return {
    localRules: [...local].sort(),
    notPorted: latestRules.filter((r) => !local.has(r)).sort(),
    notUpstream: [...local].filter((r) => !upstream.has(r)).sort(),
    presetDrift,
    severityDrift,
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * @param {string} packageName
 * @param {string} version
 */
export function issueTitle(packageName, version) {
  return `Upstream: ${packageName} ${version} released`
}

/** @param {string} packageName */
function issueTitlePattern(packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return new RegExp(`^Upstream: ${escaped} (\\S+) released$`)
}

/**
 * @param {string} packageName
 * @param {string} version
 */
export function upstreamLinks(packageName, version, previous = /** @type {string | null} */ (null)) {
  const tag = (/** @type {string} */ v) => encodeURIComponent(`${packageName}@${v}`)
  const repo = `https://github.com/${UPSTREAM_GITHUB_REPO}`
  return {
    npm: `https://www.npmjs.com/package/${packageName}/v/${version}`,
    // TanStack/query tags every package release as `<package>@<version>` (changesets).
    release: `${repo}/releases/tag/${tag(version)}`,
    compare: previous ? `${repo}/compare/${tag(previous)}...${tag(version)}` : null,
    changelog: `${repo}/blob/main/${UPSTREAM_PACKAGE_DIR}/CHANGELOG.md`,
    sources: `${repo}/tree/${tag(version)}/${UPSTREAM_PACKAGE_DIR}/src/rules`,
    ruleDocs: (/** @type {string} */ rule) => `https://tanstack.com/query/latest/docs/eslint/${rule}`,
  }
}

/** @param {string | null | undefined} iso */
const day = (iso) => (iso ? iso.slice(0, 10) : 'unknown')
/** @param {string} s */
const code = (s) => `\`${s}\``
/** @param {string[]} items */
const codeList = (items) => (items.length ? items.map(code).join(', ') : '_none_')
/** @param {string} path */
const shortPath = (path) => path.replace(/^src\/rules\/[a-z0-9-]+\//, '').replace(/^src\/rules\//, '')

/**
 * Renders the Markdown issue body.
 * @param {UpdateReport} report
 * @returns {string}
 */
export function renderIssueBody(report) {
  const { packageName, current, latest, diff, port, latestConfigs } = report
  const links = upstreamLinks(packageName, latest, current)
  const ported = new Set(port.localRules)
  const yesNo = (/** @type {boolean} */ b) => (b ? 'yes' : '**no**')
  /**
   * @param {string} preset
   * @param {string} rule
   */
  const inPreset = (preset, rule) => {
    const sev = latestConfigs[preset]?.[rule]
    return sev && sev !== 'off' ? sev : '–'
  }
  /** @type {string[]} */
  const lines = []
  const push = (/** @type {string[]} */ ...l) => lines.push(...l)

  push(
    `<!-- check-upstream: ${packageName}@${latest} -->`,
    `## ${code(packageName)} ${latest} is available`,
    '',
    '| | Version | Published |',
    '| --- | --- | --- |',
    `| Mirrored here (${code('package.json#upstream.version')}) | ${code(current)} | ${day(report.currentPublishedAt)} |`,
    `| Latest on npm (${code('dist-tags.latest')}) | ${code(latest)} | ${day(report.latestPublishedAt)} |`,
    '',
    `**Links:** [npm](${links.npm}) · [release notes](${links.release}) · [compare ${current}...${latest}](${links.compare}) · [CHANGELOG](${links.changelog}) · [rule sources @ ${latest}](${links.sources})`,
    '',
  )

  const between = report.intermediateVersions
  if (between.length > 1) {
    push(
      `<details><summary>${between.length} stable releases since ${current}</summary>`,
      '',
      between.map(code).join(' · '),
      '',
      '</details>',
      '',
    )
  }
  if (report.supersedes?.length) {
    push(`Supersedes ${report.supersedes.map((i) => `#${i.number}`).join(', ')} (older upstream releases).`, '')
  }

  push(
    '### Summary',
    '',
    `- New rules: **${diff.newRules.length}**`,
    `- Removed rules: **${diff.removedRules.length}**`,
    `- Rules with source changes: **${diff.changedRules.length}**${diff.sourcesComparable ? '' : ' _(sources not shipped in one of the tarballs — not comparable)_'}`,
    `- Shared source files changed (may affect several rules): **${diff.sharedChanges.length}**`,
    `- Preset / severity changes: **${diff.configChanges.length}**${diff.configsComparable ? '' : ' _(configs could not be extracted for both versions — verify manually)_'}`,
    `- Upstream rules not yet ported here: **${port.notPorted.length}**`,
    '',
  )

  if (diff.newRules.length) {
    push(
      '### New upstream rules',
      '',
      '| Rule | Docs | recommended | recommended-strict | Ported here |',
      '| --- | --- | --- | --- | --- |',
      ...diff.newRules.map(
        (rule) =>
          `| ${code(rule)} | [docs](${links.ruleDocs(rule)}) | ${inPreset('recommended', rule)} | ${inPreset('recommended-strict', rule)} | ${yesNo(ported.has(rule))} |`,
      ),
      '',
    )
  }

  if (diff.removedRules.length) {
    push(
      '### Removed upstream rules',
      '',
      '| Rule | Still shipped here |',
      '| --- | --- |',
      ...diff.removedRules.map((rule) => `| ${code(rule)} | ${yesNo(ported.has(rule))} |`),
      '',
    )
  }

  if (diff.changedRules.length) {
    push(
      '### Rules whose source changed',
      '',
      '| Rule | Changed files | Ported here |',
      '| --- | --- | --- |',
      ...diff.changedRules.map(
        ({ rule, files }) =>
          `| ${code(rule)} | ${files.map((f) => `${code(shortPath(f.path))} (${f.status})`).join('<br>')} | ${yesNo(ported.has(rule))} |`,
      ),
      '',
    )
  }

  if (diff.sharedChanges.length) {
    push('### Shared source changes', '', ...diff.sharedChanges.map((f) => `- ${code(f.path)} (${f.status})`), '')
  }

  if (diff.configChanges.length) {
    push(
      '### Preset / severity changes',
      '',
      `| Preset | Rule | ${current} | ${latest} |`,
      '| --- | --- | --- | --- |',
      ...diff.configChanges.map((c) => {
        const note = diff.newPresets.includes(c.preset)
          ? ' _(new preset)_'
          : diff.removedPresets.includes(c.preset)
            ? ' _(removed preset)_'
            : ''
        return `| ${c.preset}${note} | ${code(c.rule)} | ${c.from ?? '–'} | ${c.to ?? '–'} |`
      }),
      '',
    )
  }

  push(
    '### Port status of this repository',
    '',
    `- Upstream rules @ ${latest}: ${codeList(report.latestRules)}`,
    `- Ported (${code('rules/*.grit')}): ${codeList(port.localRules)}`,
    `- **Not yet ported:** ${codeList(port.notPorted)}`,
  )
  if (port.notUpstream.length) push(`- Present here but no longer upstream: ${codeList(port.notUpstream)}`)
  for (const d of port.presetDrift) {
    push(
      `- Preset drift in ${code(`rules/${d.preset}`)} (vs upstream config): missing ${codeList(d.missing)}; extra ${codeList(d.extra)}`,
    )
  }
  for (const d of port.severityDrift) {
    push(`- Severity drift for ${code(d.rule)}: here ${d.local.join('/')}, upstream ${d.upstream}`)
  }
  push('')

  const commitType = diff.newRules.length || diff.configChanges.length ? 'feat' : 'fix'
  push(
    '### Maintainer checklist',
    '',
    `- [ ] Read the [release notes](${links.release}), the [CHANGELOG](${links.changelog}) and the [compare view](${links.compare})`,
    ...diff.newRules.map(
      (rule) =>
        `- [ ] Port new rule ${code(rule)} → ${code(`rules/${rule}.grit`)}, ${code(`tests/fixtures/${rule}/`)}, ${code(`docs/rules/${rule}.md`)}`,
    ),
    ...port.notPorted
      .filter((rule) => !diff.newRules.includes(rule))
      .map((rule) => `- [ ] Port (or document the omission of) ${code(rule)}`),
    ...diff.removedRules.map((rule) => `- [ ] Decide how to deprecate/remove ${code(rule)}`),
    ...diff.changedRules.map(
      ({ rule }) => `- [ ] Review behavior changes of ${code(rule)} and update ${code(`tests/fixtures/${rule}/`)}`,
    ),
    '- [ ] Port changes to existing rules and update their fixtures / docs',
    `- [ ] Sync presets in ${code('scripts/build-index.js')} (${code('PRESETS')}) and severities, then run ${code('npm run build')}`,
    `- [ ] Bump ${code('package.json#upstream.version')} to ${code(latest)}`,
    '- [ ] Run `npm run version:sync` to add the "unreleased" row to the compatibility matrix in `README.md`',
    `- [ ] ${code('npm test')}, ${code('npm run lint')}, ${code('npm run check:index')} pass`,
    `- [ ] Commit as ${code(`${commitType}: sync with ${packageName} ${latest}`)} so semantic-release versions it`,
    '',
  )

  const footer = report.runUrl ? ` in [this workflow run](${report.runUrl})` : ''
  push(`<sub>Opened automatically by ${code('scripts/check-upstream.js')}${footer}.</sub>`)

  const body = lines.join('\n')
  return body.length > MAX_ISSUE_BODY ? `${body.slice(0, MAX_ISSUE_BODY)}\n\n…_(truncated)_` : body
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export class GitHubApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {unknown} [body]
   */
  constructor(message, status, body) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
    this.body = body
  }
}

/**
 * @param {string | null} header
 * @returns {string | null}
 */
export function parseNextLink(header) {
  if (!header) return null
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part)
    if (match) return match[1]
  }
  return null
}

/**
 * Tiny GitHub REST client.
 * @param {{ token: string, repository: string, fetchImpl?: FetchLike, apiUrl?: string, sleep?: (ms: number) => Promise<unknown> }} options
 */
export function createGitHubClient({ token, repository, fetchImpl = globalThis.fetch, apiUrl, sleep }) {
  if (!token) throw new Error('GITHUB_TOKEN is required to open issues (or pass --dry-run)')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) {
    throw new Error(`GITHUB_REPOSITORY must look like "owner/repo", got ${JSON.stringify(repository)}`)
  }
  const base = (apiUrl || 'https://api.github.com').replace(/\/+$/, '')
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
  }

  /**
   * @param {string} method
   * @param {string} pathOrUrl
   * @param {unknown} [body]
   */
  async function request(method, pathOrUrl, body) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${base}${pathOrUrl}`
    const response = await fetchWithRetry(
      url,
      {
        method,
        headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { fetchImpl, sleep },
    )
    const text = await response.text()
    /** @type {any} */
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!response.ok) {
      const detail = data && typeof data === 'object' && 'message' in data ? `: ${data.message}` : ''
      throw new GitHubApiError(`GitHub API ${method} ${url} → HTTP ${response.status}${detail}`, response.status, data)
    }
    return { data, link: response.headers.get('link') }
  }

  const repoPath = `/repos/${repository}`
  return {
    request,
    /**
     * All issues (open and closed, PRs excluded) carrying `label`.
     * @param {string} label
     * @returns {Promise<GitHubIssue[]>}
     */
    async listIssues(label) {
      /** @type {GitHubIssue[]} */
      const issues = []
      /** @type {string | null} */
      let next = `${repoPath}/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100`
      for (let page = 0; next && page < 50; page++) {
        const { data, link } = await request('GET', next)
        if (!Array.isArray(data)) throw new GitHubApiError('Unexpected response while listing issues', 200, data)
        issues.push(...data.filter((issue) => !issue.pull_request))
        next = parseNextLink(link)
      }
      return issues
    },
    /** @param {{ name: string, color: string, description: string }} label */
    async ensureLabel(label) {
      try {
        await request('GET', `${repoPath}/labels/${encodeURIComponent(label.name)}`)
        return 'exists'
      } catch (error) {
        if (!(error instanceof GitHubApiError) || error.status !== 404) throw error
      }
      try {
        await request('POST', `${repoPath}/labels`, label)
        return 'created'
      } catch (error) {
        // 422 = already exists (created concurrently): fine.
        if (error instanceof GitHubApiError && error.status === 422) return 'exists'
        throw error
      }
    },
    /**
     * @param {{ title: string, body: string, labels: string[] }} issue
     * @returns {Promise<GitHubIssue>}
     */
    async createIssue(issue) {
      const { data } = await request('POST', `${repoPath}/issues`, issue)
      return data
    },
  }
}

/**
 * @param {GitHubIssue[]} issues
 * @param {string} title
 */
export function findExistingIssue(issues, title) {
  return issues.find((issue) => !issue.pull_request && issue.title.trim() === title)
}

/**
 * Open upstream-sync issues for versions older than `version`.
 * @param {GitHubIssue[]} issues
 * @param {string} packageName
 * @param {string} version
 */
export function findSupersededIssues(issues, packageName, version) {
  const pattern = issueTitlePattern(packageName)
  return issues.filter((issue) => {
    const match = pattern.exec(issue.title.trim())
    return (
      issue.state === 'open' &&
      !issue.pull_request &&
      match &&
      isValidSemver(match[1]) &&
      compareSemver(match[1], version) < 0
    )
  })
}

/**
 * Opens the issue unless one with the same title already exists (any state).
 * @param {{ client: ReturnType<typeof createGitHubClient>, report: UpdateReport, label?: typeof ISSUE_LABEL }} params
 * @returns {Promise<{ action: 'created' | 'exists', issue: GitHubIssue, title: string, body: string | null }>}
 */
export async function syncIssue({ client, report, label = ISSUE_LABEL }) {
  const title = issueTitle(report.packageName, report.latest)
  const issues = await client.listIssues(label.name)
  const existing = findExistingIssue(issues, title)
  if (existing) return { action: 'exists', issue: existing, title, body: null }

  const supersedes = findSupersededIssues(issues, report.packageName, report.latest)
  const body = renderIssueBody({ ...report, supersedes })
  await client.ensureLabel(label)
  const issue = await client.createIssue({ title, body, labels: [label.name] })
  return { action: 'created', issue, title, body }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

let jsonMode = false
/** Progress output: stderr in --json mode so stdout stays machine-readable. */
function log(/** @type {string} */ message) {
  if (jsonMode) console.error(message)
  else console.log(message)
}

/**
 * @param {string[]} argv
 * @returns {{ dryRun: boolean, json: boolean, failOnUpdate: boolean, current: string | undefined, help: boolean }}
 */
export function parseCliArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'fail-on-update': { type: 'boolean', default: false },
      current: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  })
  if (values.current !== undefined && !isValidSemver(values.current)) {
    throw new TypeError(`--current expects a version, got ${JSON.stringify(values.current)}`)
  }
  return {
    dryRun: Boolean(values['dry-run']),
    json: Boolean(values.json),
    failOnUpdate: Boolean(values['fail-on-update']),
    current: values.current,
    help: Boolean(values.help),
  }
}

const HELP = `Usage: node scripts/check-upstream.js [options]

Checks npm for a newer @tanstack/eslint-plugin-query than package.json#upstream.version
and opens a GitHub issue (label "${ISSUE_LABEL.name}") describing what changed.

Options:
  --dry-run          print the issue instead of creating it (npm is still queried)
  --json             machine-readable report on stdout
  --fail-on-update   exit with code 2 when an update is available
  --current <ver>    override the mirrored version (testing aid, requires --dry-run;
                     env UPSTREAM_CURRENT_VERSION)
  -h, --help         show this help
`

/**
 * Builds the full update report (downloads + diffs both tarballs).
 * @param {{ packageName: string, current: string, latest: string, packument: any, fetchImpl?: FetchLike, rulesDir?: string, sleep?: (ms: number) => Promise<unknown>, env?: NodeJS.ProcessEnv }} params
 * @returns {Promise<UpdateReport>}
 */
export async function buildUpdateReport({
  packageName,
  current,
  latest,
  packument,
  fetchImpl,
  rulesDir,
  sleep,
  env = process.env,
}) {
  const currentInfo = resolveVersionInfo(packument, current)
  const latestInfo = resolveVersionInfo(packument, latest)
  log(`Downloading and verifying ${packageName}@${current} and @${latest} tarballs…`)
  const [currentTgz, latestTgz] = await Promise.all([
    downloadTarball(currentInfo, { fetchImpl, sleep }),
    downloadTarball(latestInfo, { fetchImpl, sleep }),
  ])
  const currentSnapshot = snapshotPackage(current, readPackageTarball(currentTgz))
  const latestSnapshot = snapshotPackage(latest, readPackageTarball(latestTgz))
  const diff = diffSnapshots(currentSnapshot, latestSnapshot)
  const latestRules = Object.keys(latestSnapshot.rules).sort()
  const port = computePortStatus(latestRules, latestSnapshot.configs, readLocalRules(rulesDir))
  const runUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : null
  return {
    packageName,
    current,
    latest,
    currentPublishedAt: currentInfo.publishedAt,
    latestPublishedAt: latestInfo.publishedAt,
    intermediateVersions: versionsBetween(Object.keys(packument.versions), current, latest),
    diff,
    latestRules,
    latestConfigs: latestSnapshot.configs,
    port,
    runUrl,
  }
}

/**
 * @param {string} markdown
 * @param {NodeJS.ProcessEnv} env
 */
function writeStepSummary(markdown, env) {
  const file = env.GITHUB_STEP_SUMMARY
  if (!file) return
  try {
    appendFileSync(file, `${markdown}\n`)
  } catch (error) {
    console.error(`warning: could not write job summary: ${errorMessage(error)}`)
  }
}

/**
 * @param {string[]} [argv]
 * @param {{ fetchImpl?: FetchLike, root?: string, env?: NodeJS.ProcessEnv }} [deps]
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { fetchImpl = globalThis.fetch, root = ROOT, env = process.env } = deps
  const args = parseCliArgs(argv)
  jsonMode = args.json
  if (args.help) {
    console.log(HELP)
    return 0
  }

  const pkg = readPackageJson(root)
  const packageName = pkg.upstream.package
  const current = args.current ?? (env.UPSTREAM_CURRENT_VERSION || pkg.upstream.version)
  if (!isValidSemver(current)) throw new TypeError(`Invalid current version: ${current}`)
  const overridden = current !== pkg.upstream.version ? ` (overridden; package.json says ${pkg.upstream.version})` : ''
  if (overridden && !args.dryRun) {
    // An overridden baseline would open a real issue built from a fake diff.
    throw new Error('--current / UPSTREAM_CURRENT_VERSION is a testing aid and requires --dry-run')
  }

  log(`Checking ${packageName}: mirrored version ${current}${overridden}`)
  const packument = await fetchPackument(packageName, { fetchImpl })
  const latest = packument['dist-tags']?.latest
  if (!isValidSemver(latest)) throw new Error(`npm dist-tags.latest is missing or invalid: ${latest}`)
  const cmp = compareSemver(latest, current)
  const latestPublishedAt = packument.time?.[latest] ?? null

  /** @type {Record<string, unknown>} */
  const result = { packageName, current, latest, latestPublishedAt }

  if (cmp <= 0) {
    const status = cmp === 0 ? 'up-to-date' : 'ahead'
    const message =
      cmp === 0
        ? `Up to date: ${packageName}@${latest} (published ${day(latestPublishedAt)}) is the latest release.`
        : `Mirrored version ${current} is AHEAD of npm dist-tags.latest ${latest} (a retracted or re-tagged release?). Nothing to do.`
    log(message)
    writeStepSummary(`### Upstream check\n\n${cmp === 0 ? '✅' : '⚠️'} ${message}`, env)
    if (args.json) console.log(JSON.stringify({ status, ...result }, null, 2))
    return 0
  }

  if (isPrerelease(latest)) log(`note: dist-tags.latest (${latest}) is a pre-release; treating it as an update anyway.`)
  log(`Update available: ${current} → ${latest}`)
  const report = await buildUpdateReport({
    packageName,
    current,
    latest,
    packument,
    fetchImpl,
    rulesDir: join(root, 'rules'),
    env,
  })
  const title = issueTitle(packageName, latest)

  /** @type {{ action: string, number?: number, url?: string }} */
  let issueResult
  let body = renderIssueBody(report)
  if (args.dryRun) {
    issueResult = { action: 'dry-run' }
    if (!args.json) console.log(`\n# ${title}\n\n${body}\n`)
  } else {
    const client = createGitHubClient({
      token: env.GITHUB_TOKEN ?? '',
      repository: env.GITHUB_REPOSITORY ?? '',
      fetchImpl,
      apiUrl: env.GITHUB_API_URL,
    })
    const synced = await syncIssue({ client, report })
    body = synced.body ?? body
    issueResult = { action: synced.action, number: synced.issue.number, url: synced.issue.html_url }
    log(
      synced.action === 'created'
        ? `Opened issue #${synced.issue.number}: ${synced.issue.html_url}`
        : `Issue already exists (#${synced.issue.number}, ${synced.issue.state ?? 'unknown state'}): ${synced.issue.html_url}`,
    )
  }

  const issueLine =
    issueResult.action === 'dry-run'
      ? '_Dry run: no issue was opened._'
      : `Issue ${issueResult.action === 'created' ? 'opened' : 'already exists'}: ${issueResult.url}`
  writeStepSummary(`### Upstream check\n\n🔔 **${title}**\n\n${issueLine}\n\n${body}`, env)

  if (args.json) {
    console.log(
      JSON.stringify({ status: 'update-available', ...result, title, body, report, issue: issueResult }, null, 2),
    )
  }
  return args.failOnUpdate ? 2 : 0
}

function isEntryPoint() {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(`check-upstream: ${errorMessage(error)}`)
      if (process.env.DEBUG && error instanceof Error) console.error(error.stack)
      process.exitCode = 1
    },
  )
}
