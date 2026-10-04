#!/usr/bin/env node
// Generates the composed preset plugins (`rules/index.grit` and
// `rules/recommended-strict.grit`) from the standalone rule files.
//
// Biome loads exactly one top-level pattern per `.grit` file and cannot import
// patterns from other files, so the presets are produced by concatenating the
// `pattern` definitions of every rule and invoking their entry points inside a
// single `any { ... }`.
//
// Every standalone rule file must follow this contract:
//
//   // <header comments>
//   language js
//
//   pattern tanstack_query_<rule_name>() { ... }   // entry point
//   pattern tanstack_query_<rule_name>_<helper>() { ... }   // optional helpers
//
//   and { <Anchor>, tanstack_query_<rule_name>() }
//
// <Anchor> is the node kind (e.g. `JsCallExpression()`) or `or { ... }` of
// node kinds the entry point can match. Biome evaluates the top-level pattern
// on every node of a file; a bare node-kind check in front of the entry point
// lets it reject almost every node cheaply. In the presets, rules sharing the
// same anchor are dispatched together. Measured on Biome 2.5.15, this made the
// recommended preset ~4x faster than a flat `any { rule_a(), rule_b(), ... }`.
//
// Usage:
//   node scripts/build-index.js          # (re)write the presets
//   node scripts/build-index.js --check  # exit 1 if the presets are stale

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RULES_DIR = join(ROOT, 'rules')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// Mirrors the `recommended` / `recommended-strict` configs of the upstream
// ESLint plugin. A rule listed here but missing from `rules/` fails the build.
export const PRESETS = {
  index: {
    title: 'recommended',
    rules: [
      'exhaustive-deps',
      'infinite-query-property-order',
      'mutation-property-order',
      'no-rest-destructuring',
      'no-unstable-deps',
      'no-void-query-fn',
      'stable-query-client',
    ],
  },
  'recommended-strict': {
    title: 'recommended-strict',
    rules: [
      'exhaustive-deps',
      'infinite-query-property-order',
      'mutation-property-order',
      'no-rest-destructuring',
      'no-unstable-deps',
      'no-void-query-fn',
      'prefer-query-options',
      'stable-query-client',
    ],
  },
}

export const GENERATED_FILES = Object.keys(PRESETS).map((name) => `${name}.grit`)

export function entryPointName(rule) {
  return `tanstack_query_${rule.replaceAll('-', '_')}`
}

export function listRuleFiles() {
  return readdirSync(RULES_DIR)
    .filter((file) => file.endsWith('.grit') && !GENERATED_FILES.includes(file))
    .map((file) => file.slice(0, -'.grit'.length))
    .sort()
}

/**
 * Splits a standalone rule file into its pattern definitions and its anchor,
 * dropping the `language` declaration and the trailing entry point invocation.
 */
export function extractDefinitions(rule, source) {
  const entry = entryPointName(rule)
  const lines = source.replace(/\r\n/g, '\n').trimEnd().split('\n')

  const languageIndex = lines.findIndex((line) => /^language\s+js\b/.test(line.trim()))
  if (languageIndex === -1) {
    throw new Error(`rules/${rule}.grit: missing "language js" declaration`)
  }

  const invocation = lines.at(-1).trim()
  const anchor = new RegExp(
    `^and \\{ (Js[A-Za-z]+\\(\\)|or \\{ Js[A-Za-z]+\\(\\)(?:, Js[A-Za-z]+\\(\\))* \\}), ${entry}\\(\\) \\}$`,
  ).exec(invocation)?.[1]
  if (!anchor) {
    throw new Error(
      `rules/${rule}.grit: the last line must be "and { <Anchor>, ${entry}() }" where <Anchor> is "JsNodeKind()" or "or { JsA(), JsB() }", found "${invocation}"`,
    )
  }

  const bodyLines = lines.slice(languageIndex + 1, -1)
  // Comments directly above the invocation describe the standalone entry point,
  // which the presets replace with their own.
  while (bodyLines.length > 0 && /^\s*(\/\/.*)?$/.test(bodyLines.at(-1))) bodyLines.pop()
  const body = bodyLines.join('\n').trim()
  if (!new RegExp(`^pattern\\s+${entry}\\s*\\(`, 'm').test(body)) {
    throw new Error(`rules/${rule}.grit: missing entry point definition "pattern ${entry}()"`)
  }

  const prefix = `${entry}`
  const declared = [
    ...body.matchAll(/^(?:private\s+)?(?:pattern|predicate|function)\s+([A-Za-z_][A-Za-z0-9_]*)/gm),
  ].map((match) => match[1])
  for (const name of declared) {
    if (name !== entry && !name.startsWith(`${prefix}_`)) {
      throw new Error(
        `rules/${rule}.grit: "${name}" must be prefixed with "${prefix}_" so it cannot collide with other rules in the presets`,
      )
    }
  }

  return { body, declared, anchor }
}

export function renderPreset(name) {
  const preset = PRESETS[name]
  const available = new Set(listRuleFiles())
  const seen = new Map()
  const sections = []
  /** @type {Map<string, string[]>} anchor -> entry points, in preset order */
  const dispatch = new Map()

  for (const rule of preset.rules) {
    if (!available.has(rule)) {
      throw new Error(`preset "${name}" references missing rule file rules/${rule}.grit`)
    }
    const { body, declared, anchor } = extractDefinitions(rule, readFileSync(join(RULES_DIR, `${rule}.grit`), 'utf8'))
    dispatch.set(anchor, [...(dispatch.get(anchor) ?? []), entryPointName(rule)])
    for (const definition of declared) {
      if (seen.has(definition)) {
        throw new Error(`"${definition}" is declared by both ${seen.get(definition)} and ${rule}`)
      }
      seen.set(definition, rule)
    }
    sections.push(`// ${'-'.repeat(76)}\n// @tanstack/query/${rule}\n// ${'-'.repeat(76)}\n\n${body}`)
  }

  const entries = [...dispatch]
    .map(([anchor, entryPoints]) =>
      entryPoints.length === 1
        ? `  and { ${anchor}, ${entryPoints[0]}() }`
        : `  and {\n    ${anchor},\n    any {\n${entryPoints.map((entry) => `      ${entry}()`).join(',\n')}\n    }\n  }`,
    )
    .join(',\n')

  return `// GENERATED FILE - DO NOT EDIT. Run \`npm run build\` to regenerate.
//
// ${pkg.name}@${pkg.version}: "${preset.title}" preset.
// Mirrors the "${preset.title}" config of ${pkg.upstream.package}@${pkg.upstream.version}.
//
// Rules: ${preset.rules.join(', ')}
//
// Every rule is also published as a standalone plugin next to this file
// (rules/<rule-name>.grit) if you want to cherry-pick or suppress rules
// individually with \`// biome-ignore lint/plugin/<rule-name>: <reason>\`.

language js

${sections.join('\n\n')}

// ${'-'.repeat(76)}
// Entry point. Rules are grouped by the node kind they anchor on, so most nodes
// are rejected by a cheap kind check. \`any\` (unlike \`or\`) evaluates every
// rule of a group, so a node that violates several rules reports all of them.
// ${'-'.repeat(76)}

any {
${entries}
}
`
}

function main() {
  const check = process.argv.includes('--check')
  let stale = false

  for (const name of Object.keys(PRESETS)) {
    const file = join(RULES_DIR, `${name}.grit`)
    const next = renderPreset(name)
    let current = null
    try {
      current = readFileSync(file, 'utf8')
    } catch {}

    if (current === next) continue
    if (check) {
      console.error(`rules/${name}.grit is out of date. Run \`npm run build\`.`)
      stale = true
    } else {
      writeFileSync(file, next)
      console.log(`wrote rules/${name}.grit`)
    }
  }

  if (stale) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
