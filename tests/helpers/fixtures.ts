import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIXTURES_DIR, type PluginDiagnostic } from './biome'

export interface RuleFixtures {
  rule: string
  /** `valid.tsx`, plus any `valid-<topic>.tsx` (for cases that need their own module, e.g. other imports). */
  valid: string[]
  invalid: string
  /** Expected output of `biome lint --write` on `invalid.tsx` (safe fixes only). */
  fixed?: string
  /** Expected output of `biome lint --write --unsafe` on `invalid.tsx`. */
  unsafeFixed?: string
}

export function listRuleFixtures(): RuleFixtures[] {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(FIXTURES_DIR, entry.name)
      const optional = (file: string) => (existsSync(join(dir, file)) ? join(dir, file) : undefined)
      return {
        rule: entry.name,
        valid: [
          join(dir, 'valid.tsx'),
          ...readdirSync(dir)
            .filter((file) => /^valid-[a-z0-9-]+\.tsx?$/.test(file))
            .sort()
            .map((file) => join(dir, file)),
        ],
        invalid: join(dir, 'invalid.tsx'),
        fixed: optional('invalid.fixed.tsx'),
        unsafeFixed: optional('invalid.unsafe-fixed.tsx'),
      }
    })
    .sort((a, b) => a.rule.localeCompare(b.rule))
}

/**
 * Reads the `expect:` annotations of a fixture.
 *
 * A diagnostic is expected on every line carrying an annotation comment, which
 * names the rule(s) whose diagnostic *starts* on that line:
 *
 *   const { data, ...rest } = useQuery(opts) // expect: no-rest-destructuring
 *   <Foo query={useQuery(opts)} />           {/* expect: rule-a, rule-b *\/}
 *
 * Repeat a rule name to expect several diagnostics on the same line.
 */
export function readExpectations(file: string): string[] {
  const expectations: string[] = []
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((text, index) => {
      const match = /(?:\/\/|\/\*)\s*expect:\s*([a-z-]+(?:\s*,\s*[a-z-]+)*)/.exec(text)
      if (!match) return
      for (const rule of match[1].split(',')) {
        expectations.push(`${index + 1}: ${rule.trim()}`)
      }
    })
  return expectations.sort(compareKeys)
}

/** Projects diagnostics to the same `line: rule` shape as {@link readExpectations}. */
export function toKeys(diagnostics: PluginDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => `${diagnostic.line}: ${diagnostic.rule}`).sort(compareKeys)
}

function compareKeys(a: string, b: string): number {
  return Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b)
}
