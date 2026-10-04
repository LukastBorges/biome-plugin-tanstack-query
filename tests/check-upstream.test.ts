// Unit tests for scripts/check-upstream.js. No network: every HTTP call goes
// through an injected fetch mock, and tarballs are built in memory.

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildUpdateReport,
  compareSemver,
  computePortStatus,
  createGitHubClient,
  diffSnapshots,
  downloadTarball,
  encodePackageName,
  extractConfigs,
  extractRules,
  fetchPackument,
  fetchWithRetry,
  findClosingBracket,
  findExistingIssue,
  findSupersededIssues,
  GitHubApiError,
  IntegrityError,
  issueTitle,
  main,
  parseCliArgs,
  parseConfigs,
  parsePaxHeaders,
  parseRuleMap,
  parseSemver,
  parseTar,
  readLocalRules,
  readPackageTarball,
  renderIssueBody,
  resolveVersionInfo,
  snapshotPackage,
  syncIssue,
  upstreamLinks,
  verifyIntegrity,
  versionsBetween,
} from '../scripts/check-upstream.js'

// ---------------------------------------------------------------------------
// Helpers: in-memory tar / tgz builders and a routing fetch mock
// ---------------------------------------------------------------------------

type HeaderOptions = { prefix?: string; gnu?: boolean; base256Size?: boolean; garbageAt345?: boolean }

function tarHeader(name: string, size: number, type: string, options: HeaderOptions = {}): Buffer {
  const h = Buffer.alloc(512)
  h.write(name, 0, 100, 'utf8')
  h.write('0000644\0', 100, 'latin1')
  h.write('0000000\0', 108, 'latin1')
  h.write('0000000\0', 116, 'latin1')
  if (options.base256Size) {
    h[124] = 0x80
    h.writeUInt32BE(size, 132)
  } else {
    h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1')
  }
  h.write('00000000000\0', 136, 'latin1')
  h.write(type, 156, 'latin1')
  if (options.gnu) {
    h.write('ustar  \0', 257, 'latin1')
  } else {
    h.write('ustar\0', 257, 'latin1')
    h.write('00', 263, 'latin1')
  }
  if (options.prefix) h.write(options.prefix, 345, 155, 'utf8')
  if (options.garbageAt345) h.write('not-a-prefix', 345, 'latin1')
  h.fill(0x20, 148, 156)
  let sum = 0
  for (const byte of h) sum += byte
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1')
  return h
}

function pad(data: Buffer): Buffer {
  const rest = data.length % 512
  return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(512 - rest)])
}

function tarEntry(name: string, content: string | Buffer, type = '0', options: HeaderOptions = {}): Buffer {
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  return Buffer.concat([tarHeader(name, data.length, type, options), pad(data)])
}

function paxData(records: Record<string, string>): Buffer {
  const parts = Object.entries(records).map(([key, value]) => {
    const payload = ` ${key}=${value}\n`
    let length = Buffer.byteLength(payload) + 1
    while (String(length).length + Buffer.byteLength(payload) !== length) length++
    return `${length}${payload}`
  })
  return Buffer.from(parts.join(''), 'utf8')
}

const endOfArchive = () => Buffer.alloc(1024)

function makeTar(files: Record<string, string>): Buffer {
  return Buffer.concat([...Object.entries(files).map(([name, content]) => tarEntry(name, content)), endOfArchive()])
}

function makeTgz(files: Record<string, string>): Buffer {
  const prefixed = Object.fromEntries(Object.entries(files).map(([path, content]) => [`package/${path}`, content]))
  return gzipSync(makeTar(prefixed))
}

const sri = (data: Buffer, algorithm = 'sha512') =>
  `${algorithm}-${createHash(algorithm).update(data).digest('base64')}`

type Route = (url: string, init: RequestInit) => Response | Promise<Response> | undefined

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

function mockFetch(...routes: Route[]) {
  const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = []
  const impl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    calls.push({
      url,
      method,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: { ...(init.headers as Record<string, string> | undefined) },
    })
    for (const route of routes) {
      const response = await route(url, { ...init, method })
      if (response) return response
    }
    throw new Error(`Unmocked request: ${method} ${url}`)
  })
  return { fetchImpl: impl as unknown as typeof fetch, calls, impl }
}

const noSleep = async () => {}

// A realistic copy of upstream's src/index.ts (5.104.x): hoisted maps + spread.
const INDEX_TS_HOISTED = `import { rules } from './rules'
import type { ESLint, Linter } from 'eslint'

type RuleKey = keyof typeof rules

export interface Plugin extends Omit<ESLint.Plugin, 'rules'> {
  rules: Record<RuleKey, RuleModule<any, any, any>>
  configs: {
    recommended: ESLint.ConfigData
    recommendedStrict: ESLint.ConfigData
    'flat/recommended': Array<Linter.Config>
    'flat/recommended-strict': Array<Linter.Config>
  }
}

const recommendedRules = {
  '@tanstack/query/exhaustive-deps': 'error',
  '@tanstack/query/no-rest-destructuring': 'warn',
  '@tanstack/query/stable-query-client': 'error',
  '@tanstack/query/no-unstable-deps': 'error',
  '@tanstack/query/infinite-query-property-order': 'error',
  '@tanstack/query/no-void-query-fn': 'error',
  '@tanstack/query/mutation-property-order': 'error',
} as const

const recommendedStrictRules = {
  ...recommendedRules,
  '@tanstack/query/prefer-query-options': 'error',
} as const

export const plugin = {
  meta: {
    name: '@tanstack/eslint-plugin-query',
  },
  configs: {
    recommended: {
      plugins: ['@tanstack/query'],
      rules: recommendedRules,
    },
    recommendedStrict: {
      plugins: ['@tanstack/query'],
      rules: recommendedStrictRules,
    },
    'flat/recommended': [
      {
        name: 'tanstack/query/flat/recommended',
        plugins: {
          '@tanstack/query': {}, // Assigned after plugin object created {
        },
        rules: recommendedRules,
      },
    ],
    'flat/recommended-strict': [
      {
        name: 'tanstack/query/flat/recommended-strict',
        plugins: {
          '@tanstack/query': {}, // Assigned after plugin object created
        },
        rules: recommendedStrictRules,
      },
    ],
  },
  rules,
} satisfies Plugin

export default plugin
`

// Older upstream style (5.6x-5.9x): rules inlined under configs.
const INDEX_TS_INLINE = `const plugin: Plugin = {
  meta: { name: '@tanstack/eslint-plugin-query' },
  configs: {} as Plugin['configs'],
  rules,
}

Object.assign(plugin.configs, {
  recommended: {
    plugins: ['@tanstack/query'],
    rules: {
      '@tanstack/query/exhaustive-deps': 'error',
      '@tanstack/query/no-rest-destructuring': 'warn',
      '@tanstack/query/stable-query-client': 'error',
    },
  },
  'flat/recommended': [
    {
      plugins: { '@tanstack/query': plugin },
      rules: {
        '@tanstack/query/exhaustive-deps': 'error',
        '@tanstack/query/no-rest-destructuring': 'warn',
        '@tanstack/query/stable-query-client': 'error',
      },
    },
  ],
})
`

// ---------------------------------------------------------------------------
// SemVer
// ---------------------------------------------------------------------------

describe('semver', () => {
  it('parses versions, tolerating a leading v and build metadata', () => {
    expect(parseSemver('v5.104.1-beta.2+build.7')).toMatchObject({
      major: '5',
      minor: '104',
      patch: '1',
      prerelease: ['beta', '2'],
      build: ['build', '7'],
    })
  })

  it.each(['5', '5.1', '05.1.0', '5.1.0-', '5.1.0-01', 'latest', ''])('rejects invalid version %j', (v) => {
    expect(() => parseSemver(v)).toThrow(TypeError)
  })

  it('compares numerically, not lexicographically', () => {
    expect(compareSemver('5.104.1', '5.91.0')).toBe(1)
    expect(compareSemver('5.91.0', '5.104.1')).toBe(-1)
    expect(compareSemver('10.0.0', '9.99.99')).toBe(1)
    expect(compareSemver('5.104.1', '5.104.1')).toBe(0)
    expect(compareSemver('99999999999999999999.0.0', '99999999999999999998.0.0')).toBe(1)
  })

  it('follows the SemVer 2.0.0 pre-release precedence example', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ]
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareSemver(ordered[i], ordered[i + 1]), `${ordered[i]} < ${ordered[i + 1]}`).toBe(-1)
      expect(compareSemver(ordered[i + 1], ordered[i])).toBe(1)
    }
    expect([...ordered].reverse().sort(compareSemver)).toEqual(ordered)
  })

  it('ignores build metadata', () => {
    expect(compareSemver('1.0.0+a', '1.0.0+b')).toBe(0)
  })

  it('lists stable versions in (from, to], ignoring pre-releases and older majors published later', () => {
    const versions = ['4.44.0', '5.91.0', '5.91.1', '5.100.0-beta.1', '5.100.0', '5.104.1', '6.0.0', 'garbage']
    expect(versionsBetween(versions, '5.91.0', '5.104.1')).toEqual(['5.91.1', '5.100.0', '5.104.1'])
  })
})

// ---------------------------------------------------------------------------
// tar
// ---------------------------------------------------------------------------

describe('tar reader', () => {
  it('reads regular files and skips directories and symlinks', () => {
    const tar = Buffer.concat([
      tarEntry('package/', '', '5'),
      tarEntry('package/a.txt', 'hello'),
      tarEntry('package/link', '', '2'),
      tarEntry('./package/b.txt', 'x'.repeat(1000)),
      endOfArchive(),
    ])
    const files = parseTar(tar)
    expect([...files.keys()]).toEqual(['package/a.txt', 'package/b.txt'])
    expect(files.get('package/a.txt')?.toString()).toBe('hello')
    expect(files.get('package/b.txt')?.length).toBe(1000)
  })

  it('treats a NUL typeflag as a regular file', () => {
    const files = parseTar(Buffer.concat([tarEntry('old.txt', 'v7', '\0'), endOfArchive()]))
    expect(files.get('old.txt')?.toString()).toBe('v7')
  })

  it('joins the POSIX ustar prefix field, but not for GNU headers', () => {
    const tar = Buffer.concat([
      tarEntry('file.ts', 'p', '0', { prefix: 'package/src/deeply/nested' }),
      tarEntry('gnu.ts', 'g', '0', { gnu: true, garbageAt345: true }),
      endOfArchive(),
    ])
    expect([...parseTar(tar).keys()]).toEqual(['package/src/deeply/nested/file.ts', 'gnu.ts'])
  })

  it('applies pax extended headers (path, size) to the next entry only', () => {
    const longPath = `package/src/${'very-long-directory-name/'.repeat(8)}rule.ts`
    const tar = Buffer.concat([
      tarEntry('PaxHeader/rule.ts', paxData({ path: longPath, mtime: '1700000000.5' }), 'x'),
      tarEntry('truncated-name.ts', 'pax body'),
      tarEntry('package/after.ts', 'plain'),
      endOfArchive(),
    ])
    const files = parseTar(tar)
    expect(files.get(longPath)?.toString()).toBe('pax body')
    expect(files.get('package/after.ts')?.toString()).toBe('plain')
  })

  it('applies global pax headers to all following entries', () => {
    const tar = Buffer.concat([
      tarEntry('pax_global_header', paxData({ comment: 'git sha' }), 'g'),
      tarEntry('package/a.ts', 'a'),
      endOfArchive(),
    ])
    expect(parseTar(tar).get('package/a.ts')?.toString()).toBe('a')
  })

  it('supports GNU long names (typeflag L)', () => {
    const longPath = `package/${'x'.repeat(150)}.ts`
    const tar = Buffer.concat([
      tarEntry('././@LongLink', `${longPath}\0`, 'L', { gnu: true }),
      tarEntry(longPath.slice(0, 99), 'long', '0', { gnu: true }),
      endOfArchive(),
    ])
    expect(parseTar(tar).get(longPath)?.toString()).toBe('long')
  })

  it('decodes GNU base-256 sizes', () => {
    const data = Buffer.from('base256!')
    const tar = Buffer.concat([tarHeader('b.bin', data.length, '0', { base256Size: true }), pad(data), endOfArchive()])
    expect(parseTar(tar).get('b.bin')?.toString()).toBe('base256!')
  })

  it('parses multi-byte pax records by byte length', () => {
    expect(parsePaxHeaders(paxData({ path: 'pàckage/ünïcode.ts', size: '3' }))).toEqual({
      path: 'pàckage/ünïcode.ts',
      size: '3',
    })
    expect(() => parsePaxHeaders(Buffer.from('99 path=x\n'))).toThrow(/pax/)
  })

  it('rejects corrupt headers and truncated archives', () => {
    const tar = makeTar({ 'package/a.ts': 'abc' })
    const corrupt = Buffer.from(tar)
    corrupt[0] ^= 0xff
    expect(() => parseTar(corrupt)).toThrow(/checksum/)
    const truncated = tarEntry('package/big.ts', 'x'.repeat(2000)).subarray(0, 1024)
    expect(() => parseTar(truncated)).toThrow(/truncated/)
  })

  it('gunzips npm tarballs and strips the top-level directory', () => {
    const files = readPackageTarball(makeTgz({ 'package.json': '{}', 'src/index.ts': 'export {}' }))
    expect([...files.keys()].sort()).toEqual(['package.json', 'src/index.ts'])
  })
})

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

describe('integrity verification', () => {
  const data = Buffer.from('tarball bytes')

  it('accepts a matching sha512 SRI', () => {
    expect(verifyIntegrity(data, sri(data))).toBe('sha512')
  })

  it('throws IntegrityError on mismatch', () => {
    expect(() => verifyIntegrity(Buffer.from('tampered'), sri(data))).toThrow(IntegrityError)
  })

  it('only trusts the strongest algorithm present', () => {
    const wrong512 = sri(Buffer.from('other'), 'sha512')
    expect(() => verifyIntegrity(data, `${sri(data, 'sha256')} ${wrong512}`)).toThrow(IntegrityError)
    expect(verifyIntegrity(data, `${wrong512} ${sri(data, 'sha512')}?opt`)).toBe('sha512')
  })

  it('falls back to the legacy sha1 shasum, and refuses when nothing is verifiable', () => {
    const shasum = createHash('sha1').update(data).digest('hex')
    expect(verifyIntegrity(data, null, shasum)).toBe('sha1')
    expect(() => verifyIntegrity(data, 'md5-abc', '0'.repeat(40))).toThrow(IntegrityError)
    expect(() => verifyIntegrity(data, undefined, undefined)).toThrow(/No usable integrity/)
  })

  it('downloadTarball rejects a tarball whose integrity does not match', async () => {
    const tgz = makeTgz({ 'package.json': '{}' })
    const { fetchImpl } = mockFetch(() => new Response(new Uint8Array(tgz)))
    const info = { version: '1.0.0', tarball: 'https://registry.test/x.tgz', shasum: null }
    await expect(downloadTarball({ ...info, integrity: sri(Buffer.from('nope')) }, { fetchImpl })).rejects.toThrow(
      IntegrityError,
    )
    await expect(downloadTarball({ ...info, integrity: sri(tgz) }, { fetchImpl })).resolves.toEqual(tgz)
  })
})

// ---------------------------------------------------------------------------
// HTTP / registry
// ---------------------------------------------------------------------------

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries 5xx and network errors with backoff, then succeeds', async () => {
    let n = 0
    const { fetchImpl, calls } = mockFetch(() => {
      n++
      if (n === 1) throw new TypeError('fetch failed')
      if (n === 2) return new Response('busy', { status: 503 })
      return json({ ok: true })
    })
    const sleep = vi.fn(async (_ms: number) => {})
    const response = await fetchWithRetry('https://registry.test/x', {}, { fetchImpl, sleep, baseDelayMs: 10 })
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep.mock.calls[1][0]).toBeGreaterThanOrEqual(20) // exponential
  })

  it('returns non-retryable statuses immediately', async () => {
    const { fetchImpl, calls } = mockFetch(() => new Response('', { status: 404 }))
    expect((await fetchWithRetry('https://x.test', {}, { fetchImpl, sleep: noSleep })).status).toBe(404)
    expect(calls).toHaveLength(1)
  })

  it('never replays a POST', async () => {
    const { fetchImpl, calls } = mockFetch(() => new Response('', { status: 502 }))
    const response = await fetchWithRetry('https://x.test', { method: 'POST' }, { fetchImpl, sleep: noSleep })
    expect(response.status).toBe(502)
    expect(calls).toHaveLength(1)
  })

  it('gives up after the configured retries with a descriptive error', async () => {
    const { fetchImpl, calls } = mockFetch(() => {
      throw new TypeError('getaddrinfo ENOTFOUND')
    })
    await expect(fetchWithRetry('https://x.test', {}, { fetchImpl, sleep: noSleep, retries: 2 })).rejects.toThrow(
      /GET https:\/\/x\.test failed after 3 attempt\(s\): getaddrinfo ENOTFOUND/,
    )
    expect(calls).toHaveLength(3)
  })
})

describe('npm registry', () => {
  it('encodes scoped package names', () => {
    expect(encodePackageName('@tanstack/eslint-plugin-query')).toBe('@tanstack%2Feslint-plugin-query')
    expect(encodePackageName('vitest')).toBe('vitest')
  })

  it('fetches the full packument and reports HTTP errors', async () => {
    const doc = { name: 'p', 'dist-tags': { latest: '1.0.0' }, versions: {}, time: {} }
    const ok = mockFetch((url) => (url === 'https://registry.npmjs.org/@s%2Fp' ? json(doc) : undefined))
    await expect(fetchPackument('@s/p', { fetchImpl: ok.fetchImpl })).resolves.toEqual(doc)
    expect(ok.impl.mock.calls[0][1]).toMatchObject({ headers: { accept: 'application/json' } })

    const missing = mockFetch(() => json({ error: 'Not found' }, { status: 404 }))
    await expect(fetchPackument('@s/p', { fetchImpl: missing.fetchImpl })).rejects.toThrow(/HTTP 404/)
  })

  it('resolves version metadata', () => {
    const packument = {
      name: 'p',
      versions: { '1.0.0': { dist: { tarball: 't', integrity: 'sha512-x', shasum: 'y' } } },
      time: { '1.0.0': '2026-01-01T00:00:00.000Z' },
    }
    expect(resolveVersionInfo(packument, '1.0.0')).toEqual({
      version: '1.0.0',
      tarball: 't',
      integrity: 'sha512-x',
      shasum: 'y',
      publishedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(() => resolveVersionInfo(packument, '9.9.9')).toThrow(/does not exist/)
  })
})

// ---------------------------------------------------------------------------
// Upstream analysis
// ---------------------------------------------------------------------------

const toFiles = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([path, content]) => [path, Buffer.from(content)]))

describe('rule extraction', () => {
  it('finds rules in the nested src layout and hashes their files', () => {
    const { ruleSource, rules, shared } = extractRules(
      toFiles({
        'src/rules/exhaustive-deps/exhaustive-deps.rule.ts': 'rule',
        'src/rules/exhaustive-deps/exhaustive-deps.utils.ts': 'utils',
        'src/rules/exhaustive-deps/exhaustive-deps.test.ts': 'test',
        'src/rules/infinite-query-property-order/constants.ts': 'c',
        'src/rules/infinite-query-property-order/infinite-query-property-order.rule.ts': 'r',
        'src/rules/__tests__/x.test.ts': 'ignored',
        'src/rules.ts': 'registry',
        'src/utils/ast-utils.ts': 'ast',
        'src/types.d.ts': 'ignored',
        'build/modern/index.js': 'ignored',
      }),
    )
    expect(ruleSource).toBe('src')
    expect(Object.keys(rules)).toEqual(['exhaustive-deps', 'infinite-query-property-order'])
    expect(Object.keys(rules['exhaustive-deps'])).toEqual([
      'src/rules/exhaustive-deps/exhaustive-deps.rule.ts',
      'src/rules/exhaustive-deps/exhaustive-deps.utils.ts',
    ])
    expect(rules['exhaustive-deps']['src/rules/exhaustive-deps/exhaustive-deps.rule.ts']).toBe(
      createHash('sha256').update('rule').digest('hex'),
    )
    expect(Object.keys(shared)).toEqual(['src/rules.ts', 'src/utils/ast-utils.ts'])
  })

  it('supports the old flat src layout (src/rules/<rule>.rule.ts)', () => {
    const { rules } = extractRules(
      toFiles({
        'src/rules/exhaustive-deps.rule.ts': 'a',
        'src/rules/exhaustive-deps.utils.ts': 'b',
        'src/rules/stable-query-client/stable-query-client.rule.ts': 'c',
      }),
    )
    expect(Object.keys(rules).sort()).toEqual(['exhaustive-deps', 'stable-query-client'])
    expect(Object.keys(rules['exhaustive-deps'])).toEqual([
      'src/rules/exhaustive-deps.rule.ts',
      'src/rules/exhaustive-deps.utils.ts',
    ])
  })

  it('falls back to built per-rule files (incl. .d.ts) when src is not shipped', () => {
    const { ruleSource, rules } = extractRules(
      toFiles({
        'build/lib/rules/exhaustive-deps/exhaustive-deps.rule.d.ts': '',
        'build/lib/rules/prefer-query-object-syntax/prefer-query-object-syntax.d.ts': '',
        'build/lib/rules/prefer-query-object-syntax/prefer-query-object-syntax.test.d.ts': '',
        'build/lib/rules/index.d.ts': '',
      }),
    )
    expect(ruleSource).toBe('build')
    expect(rules).toEqual({ 'exhaustive-deps': {}, 'prefer-query-object-syntax': {} })
  })

  it('falls back to the bundled rules registry', () => {
    const bundle = `//#region src/rules/exhaustive-deps/exhaustive-deps.rule.ts
const name$1 = "exhaustive-deps";
//#endregion
//#region src/rules/no-void-query-fn/no-void-query-fn.rule.ts
const name = "no-void-query-fn";
//#endregion
const rules = { [name$1]: rule$1, [name]: rule };`
    const { ruleSource, rules } = extractRules(toFiles({ 'build/modern/rules-abc.js': bundle }))
    expect(ruleSource).toBe('build')
    expect(Object.keys(rules)).toEqual(['exhaustive-deps', 'no-void-query-fn'])
  })

  it('reports "none" when nothing looks like a rule', () => {
    expect(extractRules(toFiles({ 'README.md': '' })).ruleSource).toBe('none')
  })
})

describe('config extraction', () => {
  it('finds the matching bracket while skipping strings and comments', () => {
    const src = `{ a: '}', b: "{", c: \`}\`, // }\n /* { */ d: [1, { e: 2 }] }`
    expect(findClosingBracket(src, 0)).toBe(src.length - 1)
    expect(findClosingBracket('{ unbalanced', 0)).toBe(-1)
  })

  it('parses rule maps with spreads, overrides and numeric/array severities', () => {
    const named = new Map([['base', { a: 'error' as const, b: 'warn' as const }]])
    const map = parseRuleMap(
      `...base, '@tanstack/query/b': 'off', "@tanstack/query/c": 2, '@tanstack/query/d': ['warn', { x: 1 }], '@other/e': 'error'`,
      named,
    )
    expect(map).toEqual({ a: 'error', b: 'off', c: 'error', d: 'warn' })
  })

  it('extracts hoisted recommended / recommended-strict maps (upstream 5.10x index.ts)', () => {
    const configs = parseConfigs(INDEX_TS_HOISTED)
    expect(configs.recommended).toEqual({
      'exhaustive-deps': 'error',
      'no-rest-destructuring': 'warn',
      'stable-query-client': 'error',
      'no-unstable-deps': 'error',
      'infinite-query-property-order': 'error',
      'no-void-query-fn': 'error',
      'mutation-property-order': 'error',
    })
    expect(configs['recommended-strict']).toEqual({
      ...configs.recommended,
      'prefer-query-options': 'error',
    })
  })

  it('extracts inline configs (older upstream index.ts)', () => {
    expect(parseConfigs(INDEX_TS_INLINE)).toEqual({
      recommended: { 'exhaustive-deps': 'error', 'no-rest-destructuring': 'warn', 'stable-query-client': 'error' },
    })
  })

  it('understands flat-only configs and the double-quoted built output', () => {
    const built = `const recommendedRules = {\n\t"@tanstack/query/a": "error"\n};\nconst plugin = { configs: {\n\t"flat/recommended": [{ name: "tanstack/query/flat/recommended", rules: recommendedRules }],\n\t"flat/recommended-strict": [{ rules: { ...recommendedRules, "@tanstack/query/b": "error" } }]\n} };`
    expect(parseConfigs(built)).toEqual({
      recommended: { a: 'error' },
      'recommended-strict': { a: 'error', b: 'error' },
    })
  })

  it('returns {} for computed configs it cannot read, and extractConfigs falls back to built files', () => {
    expect(parseConfigs('export const configs = { recommended: { rules: generateRecommendedConfig(rules) } }')).toEqual(
      {},
    )
    const files = toFiles({
      'src/index.ts': 'export { configs } from "./configs"',
      'build/modern/index.js': `const plugin = { configs: { recommended: { rules: { "@tanstack/query/a": "warn" } } } }`,
    })
    expect(extractConfigs(files)).toEqual({ recommended: { a: 'warn' } })
  })
})

const OLD_PACKAGE = {
  'package.json': '{"name":"@tanstack/eslint-plugin-query","version":"1.0.0"}',
  'src/index.ts': `const recommendedRules = {
  '@tanstack/query/alpha': 'error',
  '@tanstack/query/beta': 'warn',
  '@tanstack/query/gone': 'error',
} as const
export const plugin = { configs: { recommended: { rules: recommendedRules } } }`,
  'src/rules/alpha/alpha.rule.ts': 'alpha v1',
  'src/rules/alpha/alpha.utils.ts': 'alpha utils v1',
  'src/rules/beta/beta.rule.ts': 'beta v1',
  'src/rules/gone/gone.rule.ts': 'gone',
  'src/utils/ast-utils.ts': 'ast v1',
}

const NEW_PACKAGE = {
  'package.json': '{"name":"@tanstack/eslint-plugin-query","version":"1.1.0"}',
  'src/index.ts': `const recommendedRules = {
  '@tanstack/query/alpha': 'error',
  '@tanstack/query/beta': 'error',
} as const
const recommendedStrictRules = { ...recommendedRules, '@tanstack/query/gamma': 'error' } as const
export const plugin = { configs: {
  recommended: { rules: recommendedRules },
  recommendedStrict: { rules: recommendedStrictRules },
} }`,
  'src/rules/alpha/alpha.rule.ts': 'alpha v2',
  'src/rules/alpha/constants.ts': 'new file',
  'src/rules/beta/beta.rule.ts': 'beta v1',
  'src/rules/gamma/gamma.rule.ts': 'gamma',
  'src/utils/ast-utils.ts': 'ast v2',
  'src/utils/new-helper.ts': 'helper',
}

describe('diffing', () => {
  const current = snapshotPackage('1.0.0', toFiles(OLD_PACKAGE))
  const latest = snapshotPackage('1.1.0', toFiles(NEW_PACKAGE))
  const diff = diffSnapshots(current, latest)

  it('detects new, removed, changed and unchanged rules', () => {
    expect(diff.newRules).toEqual(['gamma'])
    expect(diff.removedRules).toEqual(['gone'])
    expect(diff.unchangedRules).toEqual(['beta'])
    expect(diff.changedRules).toEqual([
      {
        rule: 'alpha',
        files: [
          { path: 'src/rules/alpha/alpha.rule.ts', status: 'modified' },
          { path: 'src/rules/alpha/alpha.utils.ts', status: 'removed' },
          { path: 'src/rules/alpha/constants.ts', status: 'added' },
        ],
      },
    ])
    expect(diff.sourcesComparable).toBe(true)
  })

  it('detects shared source changes', () => {
    expect(diff.sharedChanges).toEqual([
      { path: 'src/index.ts', status: 'modified' },
      { path: 'src/utils/ast-utils.ts', status: 'modified' },
      { path: 'src/utils/new-helper.ts', status: 'added' },
    ])
  })

  it('detects config changes and new presets', () => {
    expect(diff.configsComparable).toBe(true)
    expect(diff.newPresets).toEqual(['recommended-strict'])
    expect(diff.removedPresets).toEqual([])
    expect(diff.configChanges).toEqual([
      { preset: 'recommended', rule: 'beta', from: 'warn', to: 'error' },
      { preset: 'recommended', rule: 'gone', from: 'error', to: null },
      { preset: 'recommended-strict', rule: 'alpha', from: null, to: 'error' },
      { preset: 'recommended-strict', rule: 'beta', from: null, to: 'error' },
      { preset: 'recommended-strict', rule: 'gamma', from: null, to: 'error' },
    ])
  })

  it('does not claim source changes when one side only ships built files', () => {
    const built = snapshotPackage(
      '0.9.0',
      toFiles({ 'build/lib/rules/alpha/alpha.rule.d.ts': '', 'build/lib/rules/beta/beta.rule.d.ts': '' }),
    )
    const d = diffSnapshots(built, latest)
    expect(d.sourcesComparable).toBe(false)
    expect(d.changedRules).toEqual([])
    expect(d.sharedChanges).toEqual([])
    expect(d.newRules).toEqual(['gamma'])
    expect(d.configsComparable).toBe(false)
    expect(d.newPresets).toEqual([]) // extraction failed on one side: no false "new preset"
  })
})

describe('port status', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-upstream-rules-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads local rules, excluding generated presets, with their severities', () => {
    writeFileSync(join(dir, 'alpha.grit'), 'register_diagnostic(span=$x, message="m", severity="error")')
    writeFileSync(join(dir, 'beta.grit'), 'severity="warn" ... severity = "error"')
    writeFileSync(join(dir, 'index.grit'), 'generated')
    writeFileSync(join(dir, 'recommended-strict.grit'), 'generated')
    writeFileSync(join(dir, 'notes.md'), '')
    expect(readLocalRules(dir)).toEqual([
      { name: 'alpha', severities: ['error'] },
      { name: 'beta', severities: ['error', 'warn'] },
    ])
  })

  it('computes not-ported rules, stale local rules, preset and severity drift', () => {
    const latestConfigs = {
      recommended: { alpha: 'error' as const, beta: 'error' as const },
      'recommended-strict': { alpha: 'error' as const, beta: 'error' as const, gamma: 'error' as const },
    }
    const status = computePortStatus(
      ['alpha', 'beta', 'gamma'],
      latestConfigs,
      [
        { name: 'alpha', severities: ['error'] },
        { name: 'beta', severities: ['warn'] },
        { name: 'legacy', severities: ['error'] },
      ],
      { index: { rules: ['alpha', 'legacy'] }, 'recommended-strict': { rules: ['alpha', 'beta', 'gamma'] } },
    )
    expect(status.localRules).toEqual(['alpha', 'beta', 'legacy'])
    expect(status.notPorted).toEqual(['gamma'])
    expect(status.notUpstream).toEqual(['legacy'])
    expect(status.presetDrift).toEqual([{ preset: 'index.grit', missing: ['beta'], extra: ['legacy'] }])
    expect(status.severityDrift).toEqual([{ rule: 'beta', local: ['warn'], upstream: 'error' }])
  })
})

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<Parameters<typeof renderIssueBody>[0]> = {}) {
  const current = snapshotPackage('1.0.0', toFiles(OLD_PACKAGE))
  const latest = snapshotPackage('1.1.0', toFiles(NEW_PACKAGE))
  const latestRules = Object.keys(latest.rules).sort()
  return {
    packageName: '@tanstack/eslint-plugin-query',
    current: '1.0.0',
    latest: '1.1.0',
    currentPublishedAt: '2026-01-01T10:00:00.000Z',
    latestPublishedAt: '2026-02-01T10:00:00.000Z',
    intermediateVersions: ['1.0.1', '1.1.0'],
    diff: diffSnapshots(current, latest),
    latestRules,
    latestConfigs: latest.configs,
    port: computePortStatus(latestRules, latest.configs, [{ name: 'alpha', severities: ['error'] }], {
      index: { rules: ['alpha'] },
    }),
    runUrl: 'https://github.com/o/r/actions/runs/1',
    ...overrides,
  }
}

describe('issue rendering', () => {
  it('builds the canonical title', () => {
    expect(issueTitle('@tanstack/eslint-plugin-query', '5.105.0')).toBe(
      'Upstream: @tanstack/eslint-plugin-query 5.105.0 released',
    )
  })

  it('links to npm, the per-package GitHub release tag, compare view and changelog', () => {
    const links = upstreamLinks('@tanstack/eslint-plugin-query', '5.104.1', '5.91.0')
    expect(links.npm).toBe('https://www.npmjs.com/package/@tanstack/eslint-plugin-query/v/5.104.1')
    expect(links.release).toBe(
      'https://github.com/TanStack/query/releases/tag/%40tanstack%2Feslint-plugin-query%405.104.1',
    )
    expect(links.compare).toBe(
      'https://github.com/TanStack/query/compare/%40tanstack%2Feslint-plugin-query%405.91.0...%40tanstack%2Feslint-plugin-query%405.104.1',
    )
    expect(links.changelog).toBe(
      'https://github.com/TanStack/query/blob/main/packages/eslint-plugin-query/CHANGELOG.md',
    )
    expect(links.ruleDocs('no-void-query-fn')).toBe('https://tanstack.com/query/latest/docs/eslint/no-void-query-fn')
  })

  it('renders versions, rule tables, port status and a maintainer checklist', () => {
    const body = renderIssueBody(makeReport())
    expect(body).toContain('<!-- check-upstream: @tanstack/eslint-plugin-query@1.1.0 -->')
    expect(body).toContain('| Mirrored here (`package.json#upstream.version`) | `1.0.0` | 2026-01-01 |')
    expect(body).toContain('| Latest on npm (`dist-tags.latest`) | `1.1.0` | 2026-02-01 |')
    expect(body).toContain('2 stable releases since 1.0.0')
    expect(body).toContain(
      '| `gamma` | [docs](https://tanstack.com/query/latest/docs/eslint/gamma) | – | error | **no** |',
    )
    expect(body).toContain('### Removed upstream rules')
    expect(body).toContain('| `gone` | **no** |')
    expect(body).toContain(
      '| `alpha` | `alpha.rule.ts` (modified)<br>`alpha.utils.ts` (removed)<br>`constants.ts` (added) | yes |',
    )
    expect(body).toContain('- `src/utils/new-helper.ts` (added)')
    expect(body).toContain('| recommended | `beta` | warn | error |')
    expect(body).toContain('| recommended-strict _(new preset)_ | `gamma` | – | error |')
    expect(body).toContain('**Not yet ported:** `beta`, `gamma`')
    expect(body).toContain('Preset drift in `rules/index.grit` (vs upstream config): missing `beta`; extra _none_')
    expect(body).toContain('- [ ] Port new rule `gamma` → `rules/gamma.grit`')
    expect(body).toContain('- [ ] Port (or document the omission of) `beta`')
    expect(body).toContain('- [ ] Bump `package.json#upstream.version` to `1.1.0`')
    expect(body).toContain(
      '- [ ] Run `npm run version:sync` to add the "unreleased" row to the compatibility matrix in `README.md`',
    )
    expect(body).toContain('`feat: sync with @tanstack/eslint-plugin-query 1.1.0`')
    expect(body).toContain('[this workflow run](https://github.com/o/r/actions/runs/1)')
  })

  it('flags non-comparable sources/configs and lists superseded issues', () => {
    const report = makeReport({
      supersedes: [{ number: 7, title: 'Upstream: @tanstack/eslint-plugin-query 1.0.1 released' }],
    })
    report.diff = { ...report.diff, sourcesComparable: false, configsComparable: false }
    const body = renderIssueBody(report)
    expect(body).toContain('Supersedes #7')
    expect(body).toContain('not comparable')
    expect(body).toContain('verify manually')
  })

  it('stays under GitHub’s issue body limit', () => {
    const many = Array.from({ length: 3000 }, (_, i) => `rule-number-${i}`)
    const report = makeReport()
    report.diff = { ...report.diff, newRules: many }
    const body = renderIssueBody(report)
    expect(body.length).toBeLessThanOrEqual(65_100)
    expect(body.endsWith('…_(truncated)_')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// GitHub issue sync (dedup)
// ---------------------------------------------------------------------------

const API = 'https://api.github.com'
const REPO = 'LukastBorges/biome-plugin-tanstack-query'
const TITLE = 'Upstream: @tanstack/eslint-plugin-query 1.1.0 released'

function githubRoutes(state: {
  pages: { number: number; title: string; state: string; pull_request?: object }[][]
  label?: 'exists' | 'missing' | 'race'
}): Route[] {
  return [
    (url, init) => {
      const u = new URL(url)
      if (init.method !== 'GET' || u.pathname !== `/repos/${REPO}/issues`) return undefined
      expect(u.searchParams.get('labels')).toBe('upstream-sync')
      expect(u.searchParams.get('state')).toBe('all')
      const page = Number(u.searchParams.get('page') ?? '1')
      const next =
        page < state.pages.length
          ? `<${API}/repos/${REPO}/issues?labels=upstream-sync&state=all&per_page=100&page=${page + 1}>; rel="next"`
          : ''
      return json(state.pages[page - 1] ?? [], { headers: next ? { link: next } : {} })
    },
    (url, init) => {
      if (init.method !== 'GET' || !url.endsWith('/labels/upstream-sync')) return undefined
      return state.label === 'exists'
        ? json({ name: 'upstream-sync' })
        : json({ message: 'Not Found' }, { status: 404 })
    },
    (url, init) => {
      if (init.method !== 'POST' || !url.endsWith(`/repos/${REPO}/labels`)) return undefined
      return state.label === 'race'
        ? json({ message: 'Validation Failed' }, { status: 422 })
        : json({ name: 'upstream-sync' }, { status: 201 })
    },
    (url, init) => {
      if (init.method !== 'POST' || !url.endsWith(`/repos/${REPO}/issues`)) return undefined
      return json(
        { number: 42, title: TITLE, state: 'open', html_url: `https://github.com/${REPO}/issues/42` },
        { status: 201 },
      )
    },
  ]
}

describe('GitHub sync', () => {
  it('finds exact-title matches and superseded open issues', () => {
    const issues = [
      { number: 1, title: 'Upstream: @tanstack/eslint-plugin-query 1.0.1 released', state: 'open' },
      { number: 2, title: 'Upstream: @tanstack/eslint-plugin-query 1.0.2 released', state: 'closed' },
      { number: 3, title: `${TITLE} (again)`, state: 'open' },
      { number: 4, title: TITLE, state: 'open', pull_request: {} },
      { number: 5, title: TITLE, state: 'closed' },
      { number: 6, title: 'Upstream: @tanstack/eslint-plugin-query 2.0.0 released', state: 'open' },
    ]
    expect(findExistingIssue(issues, TITLE)?.number).toBe(5)
    expect(findSupersededIssues(issues, '@tanstack/eslint-plugin-query', '1.1.0').map((i) => i.number)).toEqual([1])
  })

  it('parses Link headers', async () => {
    const { parseNextLink } = await import('../scripts/check-upstream.js')
    expect(parseNextLink('<https://a/2>; rel="next", <https://a/9>; rel="last"')).toBe('https://a/2')
    expect(parseNextLink('<https://a/1>; rel="prev"')).toBeNull()
    expect(parseNextLink(null)).toBeNull()
  })

  it('validates its configuration', () => {
    expect(() => createGitHubClient({ token: '', repository: REPO })).toThrow(/GITHUB_TOKEN/)
    expect(() => createGitHubClient({ token: 't', repository: 'nope' })).toThrow(/owner\/repo/)
  })

  it('does not open a duplicate when a CLOSED issue with the same title exists on a later page', async () => {
    const { fetchImpl, calls } = mockFetch(
      ...githubRoutes({
        pages: [
          [
            { number: 1, title: 'Upstream: @tanstack/eslint-plugin-query 1.0.1 released', state: 'open' },
            { number: 2, title: TITLE, state: 'open', pull_request: {} },
          ],
          [{ number: 9, title: TITLE, state: 'closed' }],
        ],
        label: 'exists',
      }),
    )
    const client = createGitHubClient({ token: 'secret', repository: REPO, fetchImpl })
    const result = await syncIssue({ client, report: makeReport() })
    expect(result.action).toBe('exists')
    expect(result.issue.number).toBe(9)
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
    expect(calls.filter((c) => c.url.includes('/issues?'))).toHaveLength(2)
    expect(calls[0].headers.authorization).toBe('Bearer secret')
    expect(calls[0].headers['x-github-api-version']).toBe('2022-11-28')
  })

  it('creates the label when missing and opens the issue, noting superseded issues', async () => {
    const { fetchImpl, calls } = mockFetch(
      ...githubRoutes({
        pages: [[{ number: 1, title: 'Upstream: @tanstack/eslint-plugin-query 1.0.1 released', state: 'open' }]],
        label: 'missing',
      }),
    )
    const client = createGitHubClient({ token: 't', repository: REPO, fetchImpl })
    const result = await syncIssue({ client, report: makeReport() })
    expect(result.action).toBe('created')
    expect(result.issue.number).toBe(42)
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts.map((c) => new URL(c.url).pathname)).toEqual([`/repos/${REPO}/labels`, `/repos/${REPO}/issues`])
    expect(posts[0].body).toMatchObject({ name: 'upstream-sync' })
    const issue = posts[1].body as { title: string; body: string; labels: string[] }
    expect(issue.title).toBe(TITLE)
    expect(issue.labels).toEqual(['upstream-sync'])
    expect(issue.body).toContain('Supersedes #1')
  })

  it('tolerates 422 when the label was created concurrently', async () => {
    const { fetchImpl } = mockFetch(...githubRoutes({ pages: [[]], label: 'race' }))
    const client = createGitHubClient({ token: 't', repository: REPO, fetchImpl })
    await expect(client.ensureLabel({ name: 'upstream-sync', color: 'fff', description: '' })).resolves.toBe('exists')
    await expect(syncIssue({ client, report: makeReport() })).resolves.toMatchObject({ action: 'created' })
  })

  it('surfaces API errors with status and message', async () => {
    const { fetchImpl } = mockFetch(() => json({ message: 'Bad credentials' }, { status: 401 }))
    const client = createGitHubClient({ token: 't', repository: REPO, fetchImpl })
    const error = await client.listIssues('upstream-sync').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitHubApiError)
    expect((error as GitHubApiError).status).toBe(401)
    expect((error as Error).message).toMatch(/HTTP 401: Bad credentials/)
  })
})

// ---------------------------------------------------------------------------
// CLI / end-to-end with a fake registry
// ---------------------------------------------------------------------------

describe('cli', () => {
  it('parses flags', () => {
    expect(parseCliArgs(['--dry-run', '--json', '--fail-on-update', '--current', '5.91.0'])).toEqual({
      dryRun: true,
      json: true,
      failOnUpdate: true,
      current: '5.91.0',
      help: false,
    })
    expect(() => parseCliArgs(['--current', 'latest'])).toThrow(/expects a version/)
    expect(() => parseCliArgs(['--nope'])).toThrow()
  })

  describe('main()', () => {
    let root: string
    let stdout: string[]
    let stderr: string[]
    const oldTgz = makeTgz(OLD_PACKAGE)
    const newTgz = makeTgz(NEW_PACKAGE)
    const packument = {
      name: '@tanstack/eslint-plugin-query',
      'dist-tags': { latest: '1.1.0', previous: '0.9.0' },
      versions: {
        '0.9.0': { dist: { tarball: 'https://registry.npmjs.org/p/-/p-0.9.0.tgz', integrity: sri(oldTgz) } },
        '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/p/-/p-1.0.0.tgz', integrity: sri(oldTgz) } },
        '1.0.1': { dist: { tarball: 'https://registry.npmjs.org/p/-/p-1.0.1.tgz', integrity: sri(oldTgz) } },
        '1.1.0': { dist: { tarball: 'https://registry.npmjs.org/p/-/p-1.1.0.tgz', integrity: sri(newTgz) } },
      },
      time: { '1.0.0': '2026-01-01T00:00:00.000Z', '1.1.0': '2026-02-01T00:00:00.000Z' },
    }
    const registry: Route = (url) => {
      if (url === 'https://registry.npmjs.org/@tanstack%2Feslint-plugin-query') return json(packument)
      if (url.endsWith('p-1.0.0.tgz')) return new Response(new Uint8Array(oldTgz))
      if (url.endsWith('p-1.1.0.tgz')) return new Response(new Uint8Array(newTgz))
      return undefined
    }

    function writeRepo(version: string) {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'x', upstream: { package: '@tanstack/eslint-plugin-query', version } }),
      )
    }

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'check-upstream-main-'))
      mkdirSync(join(root, 'rules'))
      writeFileSync(join(root, 'rules', 'alpha.grit'), 'severity="error"')
      writeFileSync(join(root, 'rules', 'index.grit'), '')
      stdout = []
      stderr = []
      vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void stdout.push(a.join(' ')))
      vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void stderr.push(a.join(' ')))
    })
    afterEach(() => {
      vi.restoreAllMocks()
      rmSync(root, { recursive: true, force: true })
    })

    it('exits 0 and writes a job summary when up to date', async () => {
      writeRepo('1.1.0')
      const summary = join(root, 'summary.md')
      const { fetchImpl, calls } = mockFetch(registry)
      const code = await main([], { fetchImpl, root, env: { GITHUB_STEP_SUMMARY: summary } })
      expect(code).toBe(0)
      expect(calls).toHaveLength(1) // packument only, no tarballs
      expect(stdout.join('\n')).toMatch(/Up to date: @tanstack\/eslint-plugin-query@1\.1\.0/)
      expect(readFileSync(summary, 'utf8')).toContain('Up to date')
    })

    it('treats a mirrored version ahead of dist-tags.latest as nothing to do', async () => {
      writeRepo('2.0.0')
      const { fetchImpl } = mockFetch(registry)
      expect(await main(['--json'], { fetchImpl, root, env: {} })).toBe(0)
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({ status: 'ahead', current: '2.0.0', latest: '1.1.0' })
    })

    it('--dry-run prints the issue without touching GitHub; --fail-on-update exits 2', async () => {
      writeRepo('1.0.0')
      const { fetchImpl, calls } = mockFetch(registry)
      const code = await main(['--dry-run', '--fail-on-update'], {
        fetchImpl,
        root,
        env: { GITHUB_TOKEN: 'would-be-used' },
      })
      expect(code).toBe(2)
      expect(calls.every((c) => c.url.startsWith('https://registry.npmjs.org/'))).toBe(true)
      const out = stdout.join('\n')
      expect(out).toContain(`# ${TITLE}`)
      expect(out).toContain('| `gamma` |')
      expect(out).toContain('**Not yet ported:** `beta`, `gamma`')
    })

    it('--current overrides package.json and --json emits a machine-readable report', async () => {
      writeRepo('1.1.0')
      const { fetchImpl } = mockFetch(registry)
      const code = await main(['--dry-run', '--json', '--current', '1.0.0'], { fetchImpl, root, env: {} })
      expect(code).toBe(0)
      const result = JSON.parse(stdout.join('\n'))
      expect(result).toMatchObject({ status: 'update-available', current: '1.0.0', latest: '1.1.0', title: TITLE })
      expect(result.report.diff.newRules).toEqual(['gamma'])
      expect(result.report.intermediateVersions).toEqual(['1.0.1', '1.1.0'])
      expect(result.issue).toEqual({ action: 'dry-run' })
      expect(stderr.join('\n')).toContain('Update available: 1.0.0 → 1.1.0')
    })

    it('opens the issue via the GitHub API when not a dry run', async () => {
      writeRepo('1.0.0')
      const { fetchImpl, calls } = mockFetch(registry, ...githubRoutes({ pages: [[]], label: 'exists' }))
      const env = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: REPO, GITHUB_STEP_SUMMARY: join(root, 's.md') }
      expect(await main([], { fetchImpl, root, env })).toBe(0)
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues'))).toBe(true)
      expect(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8')).toContain(
        `Issue opened: https://github.com/${REPO}/issues/42`,
      )
    })

    it('aborts when a tarball fails integrity verification', async () => {
      writeRepo('1.0.0')
      const { fetchImpl } = mockFetch(
        (url) => (url.endsWith('p-1.1.0.tgz') ? new Response(new Uint8Array(oldTgz)) : undefined),
        registry,
      )
      await expect(main(['--dry-run'], { fetchImpl, root, env: {} })).rejects.toThrow(IntegrityError)
    })

    it('refuses a --current override outside dry-run (no real issue from a fake baseline)', async () => {
      writeRepo('1.1.0')
      const { fetchImpl, calls } = mockFetch(registry)
      await expect(main(['--current', '1.0.0'], { fetchImpl, root, env: {} })).rejects.toThrow(/requires --dry-run/)
      await expect(main([], { fetchImpl, root, env: { UPSTREAM_CURRENT_VERSION: '1.0.0' } })).rejects.toThrow(
        /requires --dry-run/,
      )
      expect(calls).toHaveLength(0)
    })

    it('requires GitHub credentials outside dry-run', async () => {
      writeRepo('1.0.0')
      const { fetchImpl } = mockFetch(registry)
      await expect(main([], { fetchImpl, root, env: {} })).rejects.toThrow(/GITHUB_TOKEN/)
    })
  })

  it('buildUpdateReport uses the run URL from the Actions environment', async () => {
    const oldTgz = makeTgz(OLD_PACKAGE)
    const newTgz = makeTgz(NEW_PACKAGE)
    const packument = {
      versions: {
        '1.0.0': { dist: { tarball: 'https://r.test/a.tgz', integrity: sri(oldTgz) } },
        '1.1.0': { dist: { tarball: 'https://r.test/b.tgz', integrity: sri(newTgz) } },
      },
      time: {},
    }
    const { fetchImpl } = mockFetch((url) => new Response(new Uint8Array(url.endsWith('a.tgz') ? oldTgz : newTgz)))
    const dir = mkdtempSync(join(tmpdir(), 'check-upstream-report-'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const report = await buildUpdateReport({
        packageName: '@tanstack/eslint-plugin-query',
        current: '1.0.0',
        latest: '1.1.0',
        packument,
        fetchImpl,
        rulesDir: dir,
        env: { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '123' },
      })
      expect(report.runUrl).toBe(`https://github.com/${REPO}/actions/runs/123`)
      expect(report.port.notPorted).toEqual(['alpha', 'beta', 'gamma'])
      expect(report.latestConfigs['recommended-strict']).toMatchObject({ gamma: 'error' })
    } finally {
      vi.restoreAllMocks()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
