import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PRESETS } from '../scripts/build-index.js'
import { biomeAtLeast, PACKAGE_NAME, runBiome } from './helpers/biome'
import { listRuleFixtures, readExpectations, toKeys } from './helpers/fixtures'

// `biome-manifest.json` lets Biome load the rules and presets by package name.
// Biome 2.6.0 introduced manifests, but 2.6.2 is the first 2.6 release with
// published binaries, so it is the minimum the README documents.
const supported = biomeAtLeast('2.6.2')

const presets = Object.values(PRESETS as Record<string, { title: string; rules: string[] }>)
const fixtures = listRuleFixtures()

const scratch = mkdtempSync(join(tmpdir(), 'biome-plugin-tanstack-query-manifest-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function source(name: string, code: string): string {
  const file = join(scratch, name)
  writeFileSync(file, code)
  return file
}

// An unfixable exhaustive-deps finding before a fixable mutation-property-order one.
const mixed = source(
  'mixed.tsx',
  `import { useMutation, useQuery } from '@tanstack/react-query'

export function Todo({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['todo'], queryFn: () => fetch(id) })
  const mutation = useMutation({
    onError: () => {},
    onMutate: () => {},
  })
  return [query, mutation]
}
`,
)

describe.skipIf(!supported)('biome-manifest.json (Biome >= 2.6.2)', () => {
  describe.each(fixtures)('$rule', ({ rule, valid, invalid }) => {
    const expected = readExpectations(invalid)

    it.concurrent(`loads as \`${PACKAGE_NAME}/${rule}\``, async () => {
      const { diagnostics } = await runBiome(invalid, { plugins: [`${PACKAGE_NAME}/${rule}`] })
      expect(toKeys(diagnostics)).toEqual(expected)
    })

    for (const preset of presets.filter((preset) => preset.rules.includes(rule))) {
      it.concurrent(`behaves identically in \`${PACKAGE_NAME}/presets/${preset.title}\``, async () => {
        const plugins = [`${PACKAGE_NAME}/presets/${preset.title}`]
        const [invalidRun, ...validRuns] = await Promise.all(
          [invalid, ...valid].map((file) => runBiome(file, { plugins })),
        )
        const own = (run: typeof invalidRun) => run.diagnostics.filter((diagnostic) => diagnostic.rule === rule)
        for (const [index, validRun] of validRuns.entries()) expect(own(validRun), basename(valid[index])).toEqual([])
        expect(toKeys(own(invalidRun))).toEqual(expected)
      })
    }
  })

  it.concurrent.each(presets.map((preset) => preset.title))(
    'presets/%s applies every fix with plain `--write`',
    async (title) => {
      const { output } = await runBiome(mixed, { plugins: [`${PACKAGE_NAME}/presets/${title}`], write: true })
      expect(output).toContain('    onMutate: () => {},\n    onError: () => {},\n')
    },
  )

  it.concurrent('suppresses one rule of a preset with `lint/plugin/<package>/<rule>`', async () => {
    const suppressed = source(
      'suppressed.tsx',
      `import { useMutation, useQuery } from '@tanstack/react-query'

export function Todo({ id }: { id: string }) {
  // biome-ignore lint/plugin/${PACKAGE_NAME}/exhaustive-deps: the key is complete
  const query = useQuery({ queryKey: ['todo'], queryFn: () => fetch(id) })
  const mutation = useMutation({
    onError: () => {},
    onMutate: () => {},
  })
  return [query, mutation]
}
`,
    )
    const { diagnostics } = await runBiome(suppressed, { plugins: [`${PACKAGE_NAME}/presets/recommended`] })
    expect(toKeys(diagnostics)).toEqual(['7: mutation-property-order'])
  })

  it.concurrent.each(['plugin-entry', 'override'] as const)('can be limited to some files via %s', async (via) => {
    const plugins = [`${PACKAGE_NAME}/presets/recommended`]
    const scope = { includes: ['src/**/*.tsx'], via }
    const inside = await runBiome(mixed, { plugins, scope, path: 'src/mixed.tsx' })
    const outside = await runBiome(mixed, { plugins, scope, path: 'lib/mixed.tsx' })
    expect(toKeys(inside.diagnostics)).toEqual(['4: exhaustive-deps', '6: mutation-property-order'])
    expect(outside.diagnostics).toEqual([])
  })
})
