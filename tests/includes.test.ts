import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { biomeAtLeast, FIXTURES_DIR, runBiome } from './helpers/biome'

// The README's "Limit the plugin to some files" examples.
const includes = ['src/**/*.{ts,tsx}', '!**/*.test.tsx']
const fixture = join(FIXTURES_DIR, 'no-rest-destructuring', 'invalid.tsx')
const plugins = ['no-rest-destructuring.grit']

// Before 2.6.2, Biome matched the `includes` of a `plugins` entry against
// absolute paths, so a relative glob never matched and the plugin silently did
// nothing (https://github.com/biomejs/biome/issues/11082). The minimum
// supported Biome still has that bug, which the README documents.
const pluginEntryWorks = biomeAtLeast('2.6.2')

describe.each([
  { title: 'with an `overrides` entry', via: 'override', works: true },
  { title: 'with `includes` on the `plugins` entry (Biome >= 2.6.2)', via: 'plugin-entry', works: pluginEntryWorks },
] as const)('limiting the plugin to some files $title', ({ via, works }) => {
  const scope = { includes, via }

  ;(works ? it : it.fails)('applies to matching files', async () => {
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
