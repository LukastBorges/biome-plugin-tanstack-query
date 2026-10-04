import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractDefinitions, listRuleFiles, PRESETS, renderPreset } from '../scripts/build-index.js'
import { RULES_DIR, runBiome } from './helpers/biome'
import { listRuleFixtures, readExpectations, toKeys } from './helpers/fixtures'

/**
 * Every rule of the mirrored @tanstack/eslint-plugin-query release, with the
 * severity it has in the upstream `recommended` / `recommended-strict` config.
 * Biome's JSON reporter spells `warn` as `warning`.
 */
const UPSTREAM_RULES: Record<string, 'error' | 'warning'> = {
  'exhaustive-deps': 'error',
  'infinite-query-property-order': 'error',
  'mutation-property-order': 'error',
  'no-rest-destructuring': 'warning',
  'no-unstable-deps': 'error',
  'no-void-query-fn': 'error',
  'prefer-query-options': 'error',
  'stable-query-client': 'error',
}

const presets = PRESETS as Record<string, { title: string; rules: string[] }>
const fixtures = listRuleFixtures()

describe('repository layout', () => {
  it('ships one standalone plugin and one fixture directory per upstream rule', () => {
    expect(listRuleFiles()).toEqual(Object.keys(UPSTREAM_RULES).sort())
    expect(fixtures.map((fixture) => fixture.rule)).toEqual(Object.keys(UPSTREAM_RULES).sort())
  })

  it.each(Object.keys(presets))('rules/%s.grit is up to date with the rule files', (name) => {
    const current = readFileSync(join(RULES_DIR, `${name}.grit`), 'utf8')
    expect(current, 'run `npm run build`').toBe(renderPreset(name))
  })
})

describe.each(fixtures)('$rule', ({ rule, valid, invalid, fixed, unsafeFixed }) => {
  const plugin = `${rule}.grit`
  const expected = readExpectations(invalid)
  const presetsWithRule = Object.entries(presets)
    .filter(([, preset]) => preset.rules.includes(rule))
    .map(([name]) => `${name}.grit`)

  it('follows the standalone rule file contract', () => {
    expect(() => extractDefinitions(rule, readFileSync(join(RULES_DIR, plugin), 'utf8'))).not.toThrow()
  })

  it('valid and invalid fixtures carry the right annotations', () => {
    for (const file of valid) expect(readExpectations(file), basename(file)).toEqual([])
    expect(expected.length).toBeGreaterThan(0)
    expect(new Set(expected.map((key) => key.split(': ')[1]))).toEqual(new Set([rule]))
  })

  it.concurrent.each(valid.map((file) => [basename(file), file]))('reports nothing on %s', async (_, file) => {
    const { diagnostics } = await runBiome(file, { plugins: [plugin] })
    expect(diagnostics).toEqual([])
  })

  it.concurrent('reports every annotated line of invalid.tsx, and nothing else', async () => {
    const { diagnostics } = await runBiome(invalid, { plugins: [plugin] })
    expect(toKeys(diagnostics)).toEqual(expected)
  })

  it.concurrent(`reports with the upstream severity (${UPSTREAM_RULES[rule]})`, async () => {
    const { diagnostics } = await runBiome(invalid, { plugins: [plugin] })
    expect(new Set(diagnostics.map((diagnostic) => diagnostic.severity))).toEqual(new Set([UPSTREAM_RULES[rule]]))
  })

  if (fixed) {
    it.concurrent('applies its safe fixes with `biome lint --write`', async () => {
      const { output } = await runBiome(invalid, { plugins: [plugin], write: true })
      expect(output).toBe(readFileSync(fixed, 'utf8'))
    })
  } else {
    it.concurrent('does not rewrite anything with `biome lint --write`', async () => {
      const { output } = await runBiome(invalid, { plugins: [plugin], write: true })
      expect(output).toBe(readFileSync(invalid, 'utf8'))
    })
  }

  it.concurrent(
    unsafeFixed
      ? 'applies its unsafe fixes with `biome lint --write --unsafe`'
      : 'has no unsafe fixes beyond its safe ones (`biome lint --write --unsafe`)',
    async () => {
      const { output } = await runBiome(invalid, { plugins: [plugin], unsafe: true })
      expect(output).toBe(readFileSync(unsafeFixed ?? fixed ?? invalid, 'utf8'))
    },
  )

  for (const preset of presetsWithRule) {
    it.concurrent(`behaves identically when composed into ${preset}`, async () => {
      const [invalidRun, ...validRuns] = await Promise.all(
        [invalid, ...valid].map((file) => runBiome(file, { plugins: [preset] })),
      )
      const own = (run: typeof invalidRun) => run.diagnostics.filter((diagnostic) => diagnostic.rule === rule)
      for (const validRun of validRuns) expect(own(validRun)).toEqual([])
      expect(toKeys(own(invalidRun))).toEqual(expected)
    })

    if (fixed || unsafeFixed) {
      // Biome 2.5 merges every rewrite of a plugin file into the fix of the
      // file's FIRST plugin diagnostic. In a preset that diagnostic may come
      // from a rule without a fix, so plain `--write` can skip these rewrites;
      // `--write --unsafe` always applies them (documented in the README).
      it.concurrent(`applies its fixes when composed into ${preset} with \`--write --unsafe\``, async () => {
        const { output } = await runBiome(invalid, { plugins: [preset], unsafe: true })
        expect(output).toBe(readFileSync(unsafeFixed ?? fixed ?? invalid, 'utf8'))
      })
    }
  }
})
