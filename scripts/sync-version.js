#!/usr/bin/env node
// Keeps every human-facing mention of versions in sync with package.json.
//
// - README.md compatibility matrix: one row per range of plugin releases that
//   mirror the same @tanstack/eslint-plugin-query version with the same Biome
//   floor, newest first. A row is labelled "`X.Y.Z` and later" (current),
//   "`A.B.C` – `X.Y.Z`" (closed), or "unreleased" (mapping changed on `main`
//   since the last release).
// - SECURITY.md: the supported major version.
// - rules/index.grit and rules/recommended-strict.grit: regenerated, their
//   header records the plugin version they were built for.
//
// Usage:
//   node scripts/sync-version.js                       # development: add/update the "unreleased" row
//   node scripts/sync-version.js --check               # exit 1 if development mode would change anything
//   node scripts/sync-version.js <next> [<previous>]   # release (run by semantic-release after
//                                                      # @semantic-release/npm bumped package.json;
//                                                      # prereleases only regenerate the presets)

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export const UNRELEASED = 'unreleased'

/** Reads the facts the matrix is built from. */
export function currentMapping(pkg) {
  const floor = /^>=\s*(\d+\.\d+\.\d+)$/.exec(pkg.peerDependencies?.['@biomejs/biome'] ?? '')?.[1]
  if (!floor) throw new Error('package.json peerDependencies["@biomejs/biome"] must be a plain ">=x.y.z" range')
  return { upstream: pkg.upstream.version, biome: floor }
}

const HEADER = [
  '| `biome-plugin-tanstack-query` | Mirrors `@tanstack/eslint-plugin-query` | Requires `@biomejs/biome` |',
  '| ----------------------------- | --------------------------------------- | ------------------------- |',
]

function parseMatrix(readme) {
  const start = readme.indexOf(HEADER[0])
  if (start === -1) throw new Error('README.md: compatibility matrix header not found')
  const lines = readme.slice(start).split('\n')
  let end = 2
  while (end < lines.length && lines[end].startsWith('|')) end++
  const rows = lines.slice(2, end).map((line) => {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    const tick = (cell) => /^`(.+)`$/.exec(cell)?.[1] ?? cell
    return { label: cells[0], upstream: tick(cells[1]), biome: tick(cells[2]).replace(/^>=\s*/, '') }
  })
  const before = readme.slice(0, start)
  const after = lines.slice(end).join('\n')
  return { before, rows, after }
}

function renderMatrix({ before, rows, after }) {
  const body = rows.map((row) => `| ${row.label} | \`${row.upstream}\` | \`>= ${row.biome}\` |`)
  return `${before}${[...HEADER, ...body].join('\n')}\n${after}`
}

const startOf = (label) => /^`([^`]+)`/.exec(label)?.[1]
const sameMapping = (row, mapping) => row.upstream === mapping.upstream && row.biome === mapping.biome

/**
 * Updates the README compatibility matrix.
 * Without `next` (development), only an "unreleased" row is added or updated.
 * With `next` (release), the "unreleased" row becomes "`next` and later" and the
 * previous current row is closed at `previous`.
 */
export function syncReadme(readme, mapping, { next, previous } = {}) {
  const matrix = parseMatrix(readme)
  const rows = matrix.rows.map((row) => ({ ...row }))
  const top = rows[0]

  if (!next) {
    if (top?.label === UNRELEASED) {
      if (rows[1] && sameMapping(rows[1], mapping)) rows.shift()
      else Object.assign(top, mapping)
    } else if (!top || !sameMapping(top, mapping)) {
      rows.unshift({ label: UNRELEASED, ...mapping })
    }
    return renderMatrix({ ...matrix, rows })
  }

  if (top?.label === UNRELEASED) rows.shift()
  const current = rows[0]
  if (current && sameMapping(current, mapping)) {
    return renderMatrix({ ...matrix, rows })
  }
  if (current) {
    const start = startOf(current.label)
    if (!previous) throw new Error('the previous release version is required to close the current matrix row')
    current.label = start === previous ? `\`${start}\`` : `\`${start}\` – \`${previous}\``
  }
  rows.unshift({ label: `\`${next}\` and later`, ...mapping })
  return renderMatrix({ ...matrix, rows })
}

/** Points SECURITY.md's "supported versions" table at the major line of `version`. */
export function syncSecurity(security, version) {
  const major = version.split('.')[0]
  const updated = security.replace(/\| latest `\d+\.x`(\s*)\|/, (_, pad) => `| latest \`${major}.x\`${pad}|`)
  if (!/\| latest `\d+\.x`/.test(security)) throw new Error('SECURITY.md: "| latest `N.x` |" row not found')
  return updated
}

async function main(argv) {
  const check = argv.includes('--check')
  const [next, previous] = argv.filter((arg) => !arg.startsWith('--'))
  for (const version of [next, previous]) {
    if (version && !SEMVER.test(version)) throw new Error(`not a semver version: ${version}`)
  }

  const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  const pkg = JSON.parse(read('package.json'))
  if (next && pkg.version !== next) {
    throw new Error(`package.json has version ${pkg.version}, expected ${next} (run after @semantic-release/npm)`)
  }
  const mapping = currentMapping(pkg)

  // Prereleases (the `next` branch) only regenerate the presets: the matrix and
  // the security policy describe stable releases.
  const prerelease = next?.includes('-') ?? false
  const updates = {}
  if (!prerelease) updates['README.md'] = syncReadme(read('README.md'), mapping, { next, previous })
  if (next && !prerelease) updates['SECURITY.md'] = syncSecurity(read('SECURITY.md'), next)

  const stale = Object.entries(updates).filter(([file, content]) => read(file) !== content)
  if (check) {
    for (const [file] of stale) console.error(`${file} is out of date. Run \`npm run version:sync\`.`)
    process.exit(stale.length > 0 ? 1 : 0)
  }
  for (const [file, content] of stale) {
    writeFileSync(join(ROOT, file), content)
    console.log(`updated ${file}`)
  }

  if (next) {
    // The presets embed package.json#version in their header.
    const { PRESETS, renderPreset } = await import('./build-index.js')
    for (const name of Object.keys(PRESETS)) {
      writeFileSync(join(ROOT, 'rules', `${name}.grit`), renderPreset(name))
      console.log(`regenerated rules/${name}.grit`)
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
