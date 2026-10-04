import { describe, expect, it } from 'vitest'
import { comparePack } from '../scripts/check-pack.js'

const rules = ['rules/index.grit', 'rules/no-rest-destructuring.grit', 'rules/recommended-strict.grit']
const good = ['LICENSE', 'README.md', 'package.json', ...rules]

describe('scripts/check-pack.js', () => {
  it('accepts exactly the plugins, README, LICENSE and package.json', () => {
    expect(comparePack(good, rules)).toEqual({ missing: [], unexpected: [] })
  })

  it('tolerates CHANGELOG.md without requiring it', () => {
    expect(comparePack([...good, 'CHANGELOG.md'], rules)).toEqual({ missing: [], unexpected: [] })
  })

  it('reports anything else as unexpected', () => {
    const packed = [
      ...good,
      'docs/rules/no-rest-destructuring.md',
      'tests/fixtures/x/valid.tsx',
      'scripts/build-index.js',
    ]
    expect(comparePack(packed, rules).unexpected).toEqual([
      'docs/rules/no-rest-destructuring.md',
      'scripts/build-index.js',
      'tests/fixtures/x/valid.tsx',
    ])
  })

  it('reports missing rule files and presets even when they are absent on disk', () => {
    const packed = ['LICENSE', 'README.md', 'package.json', 'rules/no-rest-destructuring.grit']
    expect(comparePack(packed, ['rules/no-rest-destructuring.grit', 'rules/stable-query-client.grit']).missing).toEqual(
      ['rules/index.grit', 'rules/recommended-strict.grit', 'rules/stable-query-client.grit'],
    )
  })
})
