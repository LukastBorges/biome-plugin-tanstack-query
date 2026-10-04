import { describe, expect, it } from 'vitest'
import { syncReadme, syncSecurity } from '../scripts/sync-version.js'

const matrix = (...rows: string[]) =>
  [
    '## Compatibility',
    '',
    '| `biome-plugin-tanstack-query` | Mirrors `@tanstack/eslint-plugin-query` | Requires `@biomejs/biome` |',
    '| ----------------------------- | --------------------------------------- | ------------------------- |',
    ...rows,
    '',
    '- notes',
  ].join('\n')

const v1 = { upstream: '5.104.1', biome: '2.5.2' }
const v2 = { upstream: '5.110.0', biome: '2.5.2' }

describe('syncReadme', () => {
  it('turns the "unreleased" row into the first release', () => {
    const readme = matrix('| unreleased | `5.104.1` | `>= 2.5.2` |')
    expect(syncReadme(readme, v1, { next: '1.0.0' })).toBe(matrix('| `1.0.0` and later | `5.104.1` | `>= 2.5.2` |'))
  })

  it('leaves the matrix alone when a release keeps the same mapping', () => {
    const readme = matrix('| `1.0.0` and later | `5.104.1` | `>= 2.5.2` |')
    expect(syncReadme(readme, v1, { next: '1.3.0', previous: '1.2.9' })).toBe(readme)
  })

  it('adds an "unreleased" row in development when the mapping changes, and updates it in place', () => {
    const released = matrix('| `1.0.0` and later | `5.104.1` | `>= 2.5.2` |')
    const pending = syncReadme(released, v2)
    expect(pending).toBe(
      matrix('| unreleased | `5.110.0` | `>= 2.5.2` |', '| `1.0.0` and later | `5.104.1` | `>= 2.5.2` |'),
    )
    expect(syncReadme(pending, v2)).toBe(pending)
    expect(syncReadme(pending, { upstream: '5.111.0', biome: '2.6.0' })).toBe(
      matrix('| unreleased | `5.111.0` | `>= 2.6.0` |', '| `1.0.0` and later | `5.104.1` | `>= 2.5.2` |'),
    )
    // Reverting the mapping drops the now-pointless "unreleased" row.
    expect(syncReadme(pending, v1)).toBe(released)
  })

  it('closes the previous row on release', () => {
    const pending = matrix('| unreleased | `5.110.0` | `>= 2.5.2` |', '| `1.0.0` and later | `5.104.1` | `>= 2.5.2` |')
    const expected = matrix(
      '| `1.5.0` and later | `5.110.0` | `>= 2.5.2` |',
      '| `1.0.0` – `1.4.2` | `5.104.1` | `>= 2.5.2` |',
    )
    expect(syncReadme(pending, v2, { next: '1.5.0', previous: '1.4.2' })).toBe(expected)
    // Same result when nobody ran `npm run version:sync` before releasing.
    expect(
      syncReadme(matrix('| `1.0.0` and later | `5.104.1` | `>= 2.5.2` |'), v2, { next: '1.5.0', previous: '1.4.2' }),
    ).toBe(expected)
  })

  it('labels a single-release row with that one version', () => {
    const readme = matrix('| `1.0.0` and later | `5.104.1` | `>= 2.5.2` |')
    expect(syncReadme(readme, v2, { next: '1.0.1', previous: '1.0.0' })).toBe(
      matrix('| `1.0.1` and later | `5.110.0` | `>= 2.5.2` |', '| `1.0.0` | `5.104.1` | `>= 2.5.2` |'),
    )
  })

  it('refuses to close a row without the previous version', () => {
    const readme = matrix('| `1.0.0` and later | `5.104.1` | `>= 2.5.2` |')
    expect(() => syncReadme(readme, v2, { next: '2.0.0' })).toThrow(/previous release/)
  })
})

describe('syncSecurity', () => {
  it('points the supported row at the released major', () => {
    const security = '| Version         | Supported |\n| latest `1.x`    | Yes       |\n'
    expect(syncSecurity(security, '2.0.0')).toBe('| Version         | Supported |\n| latest `2.x`    | Yes       |\n')
    expect(syncSecurity(security, '1.4.0')).toBe(security)
  })
})
