// Property-based (fuzz) tests for the code that parses untrusted input: npm
// tarballs and version strings fetched by scripts/check-upstream.js, and the
// README table rewritten by scripts/sync-version.js.
import { gzipSync } from 'node:zlib'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  findClosingBracket,
  parsePaxHeaders,
  parseSemver,
  parseTar,
  readPackageTarball,
} from '../scripts/check-upstream.js'
import { syncReadme } from '../scripts/sync-version.js'

const RUNS = { numRuns: 300 }

/** Only plain `Error`s (incl. TypeError/RangeError) may escape a parser. */
function parsesOrThrowsError(parse: () => unknown) {
  try {
    parse()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
  }
}

// ---------------------------------------------------------------------------
// Tar
// ---------------------------------------------------------------------------

function header(name: string, size: number, type = '0') {
  const block = Buffer.alloc(512)
  block.write(name, 0, 100, 'utf8')
  block.write('0000644\0', 100, 'latin1')
  block.write('0000000\0', 108, 'latin1')
  block.write('0000000\0', 116, 'latin1')
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1')
  block.write('00000000000\0', 136, 'latin1')
  block.write(type, 156, 'latin1')
  block.write('ustar\0', 257, 'latin1')
  block.write('00', 263, 'latin1')
  block.fill(0x20, 148, 156)
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1')
  return block
}

function tar(files: Array<[string, Buffer]>) {
  const parts: Buffer[] = []
  for (const [name, data] of files) {
    parts.push(header(name, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

const pathSegment = fc.stringMatching(/^[a-z0-9_-]{1,12}$/)
const filePath = fc.array(pathSegment, { minLength: 1, maxLength: 4 }).map((segments) => segments.join('/'))
const files = fc.uniqueArray(
  fc.tuple(
    filePath,
    fc.uint8Array({ maxLength: 1500 }).map((a) => Buffer.from(a)),
  ),
  {
    selector: ([path]) => path,
    maxLength: 6,
  },
)

describe('parseTar', () => {
  it('round-trips arbitrary archives', () => {
    fc.assert(
      fc.property(files, (entries) => {
        expect(parseTar(tar(entries))).toEqual(new Map(entries))
      }),
      RUNS,
    )
  })

  it('never fails with anything but an Error on corrupted archives', () => {
    fc.assert(
      fc.property(
        files,
        fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 16 }),
        (entries, flips) => {
          const archive = tar(entries)
          for (const [index, byte] of flips) archive[index % archive.length] = byte
          parsesOrThrowsError(() => parseTar(archive))
        },
      ),
      RUNS,
    )
  })

  it('never fails with anything but an Error on random bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
        parsesOrThrowsError(() => parseTar(Buffer.from(bytes)))
        parsesOrThrowsError(() => readPackageTarball(Buffer.from(bytes)))
        parsesOrThrowsError(() => readPackageTarball(gzipSync(bytes)))
      }),
      RUNS,
    )
  })

  it('parses arbitrary pax headers without crashing', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (text) => {
        parsesOrThrowsError(() => parsePaxHeaders(Buffer.from(text)))
      }),
      RUNS,
    )
  })
})

// ---------------------------------------------------------------------------
// SemVer
// ---------------------------------------------------------------------------

const numeric = fc.oneof(fc.constant('0'), fc.stringMatching(/^[1-9][0-9]{0,20}$/))
const identifier = fc.oneof(numeric, fc.stringMatching(/^[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*$/))
const semver = fc
  .tuple(numeric, numeric, numeric, fc.array(identifier, { maxLength: 3 }), fc.array(identifier, { maxLength: 2 }))
  .map(
    ([major, minor, patch, pre, build]) =>
      `${major}.${minor}.${patch}${pre.length ? `-${pre.join('.')}` : ''}${build.length ? `+${build.join('.')}` : ''}`,
  )

describe('compareSemver', () => {
  it('is a total order', () => {
    fc.assert(
      fc.property(semver, semver, semver, (a, b, c) => {
        expect(compareSemver(a, a)).toBe(0)
        expect(compareSemver(a, b)).toBe(-compareSemver(b, a) || 0)
        if (compareSemver(a, b) <= 0 && compareSemver(b, c) <= 0) expect(compareSemver(a, c)).toBeLessThanOrEqual(0)
      }),
      RUNS,
    )
  })

  it('ignores build metadata', () => {
    fc.assert(
      fc.property(semver, (version) => {
        expect(compareSemver(version, version.split('+')[0])).toBe(0)
      }),
      RUNS,
    )
  })

  it('rejects arbitrary strings with a TypeError, never anything else', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        parsesOrThrowsError(() => parseSemver(text))
      }),
      RUNS,
    )
  })
})

// ---------------------------------------------------------------------------
// Source scanning and README sync
// ---------------------------------------------------------------------------

describe('findClosingBracket', () => {
  it('returns -1 or the index of a matching closing bracket', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(...'{}[]()\'"`/*\nab ') }), fc.nat(), (body, at) => {
        const source = `${body.slice(0, at % (body.length + 1))}{${body}`
        const open = source.indexOf('{', at % (body.length + 1))
        const close = findClosingBracket(source, open)
        if (close !== -1) {
          expect(close).toBeGreaterThan(open)
          expect(source[close]).toBe('}')
        }
      }),
      RUNS,
    )
  })
})

describe('syncReadme', () => {
  const readme = (rows: string[]) =>
    [
      '| `biome-plugin-tanstack-query` | Mirrors `@tanstack/eslint-plugin-query` | Requires `@biomejs/biome` |',
      '| ----------------------------- | --------------------------------------- | ------------------------- |',
      ...rows,
      '',
    ].join('\n')
  const version = fc.tuple(fc.nat(30), fc.nat(30), fc.nat(30)).map((parts) => parts.join('.'))

  it('is idempotent in development mode', () => {
    fc.assert(
      fc.property(version, version, version, (released, upstream, biome) => {
        const start = readme([`| \`${released}\` and later | \`5.104.1\` | \`>= 2.5.2\` |`])
        const once = syncReadme(start, { upstream, biome })
        expect(syncReadme(once, { upstream, biome })).toBe(once)
      }),
      RUNS,
    )
  })
})
