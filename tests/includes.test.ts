import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURES_DIR, runBiome } from './helpers/biome'

// The README's "Limit the plugin to some files" example.
const includes = ['src/**/*.{ts,tsx}', '!**/*.test.tsx']
const fixture = join(FIXTURES_DIR, 'no-rest-destructuring', 'invalid.tsx')
const plugins = ['no-rest-destructuring.grit']

describe('limiting the plugin to some files', () => {
  describe('with an `overrides` entry (documented)', () => {
    const scope = { includes, via: 'override' } as const

    it('applies to matching files', async () => {
      const { diagnostics } = await runBiome(fixture, { plugins, scope, path: 'src/query.tsx' })
      expect(diagnostics).not.toHaveLength(0)
    })

    it('skips files outside the globs', async () => {
      const { diagnostics } = await runBiome(fixture, { plugins, scope, path: 'lib/query.tsx' })
      expect(diagnostics).toHaveLength(0)
    })

    it('skips negated files', async () => {
      const { diagnostics } = await runBiome(fixture, { plugins, scope, path: 'src/query.test.tsx' })
      expect(diagnostics).toHaveLength(0)
    })
  })

  // Biome matches the `includes` of a `plugins` entry against absolute paths,
  // so a relative glob never matches and the plugin silently does nothing
  // (https://github.com/biomejs/biome/issues/11082).
  // When this starts failing, Biome has fixed it: the README can then show
  // the shorter `plugins: [{ path, includes }]` form again.
  it.fails('with `includes` on the `plugins` entry (Biome bug: relative globs never match)', async () => {
    const scope = { includes, via: 'plugin-entry' } as const
    const { diagnostics } = await runBiome(fixture, { plugins, scope, path: 'src/query.tsx' })
    expect(diagnostics).not.toHaveLength(0)
  })
})
