#!/usr/bin/env node
// Guards the contents of the published tarball.
//
// The package is consumed by pointing Biome at
// `./node_modules/biome-plugin-tanstack-query/rules/<file>.grit`, so the
// tarball must contain the GritQL plugins and the legal/user-facing documents
// and nothing else: no tests, fixtures, scripts, docs or tool configs.
//
// Runs `npm pack --dry-run --json` (which honours `files`, `.npmignore` and
// npm's always-included files exactly like `npm publish` does) and compares
// the result with the expected file list.
//
// Usage:
//   node scripts/check-pack.js          # exit 1 with a diff if the tarball is wrong
//   node scripts/check-pack.js --list   # also print the tarball contents

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Files that must always be in the tarball. */
export const REQUIRED_FILES = ['LICENSE', 'README.md', 'package.json']

/**
 * Files that are tolerated but not required. CHANGELOG.md is written by
 * semantic-release at release time; it is not listed in `files` (release notes
 * live on GitHub Releases) and npm >= 9 no longer auto-includes it, but
 * shipping it would be harmless.
 */
export const ALLOWED_FILES = ['CHANGELOG.md']

/** Generated presets (scripts/build-index.js) that consumers reference from biome.json. */
export const REQUIRED_PRESETS = ['rules/index.grit', 'rules/recommended-strict.grit']

/**
 * Compares the files of a packed tarball with what this repository should ship.
 *
 * @param {string[]} packed      Paths inside the tarball (relative, `/`-separated).
 * @param {string[]} ruleFiles   `rules/*.grit` files present on disk.
 * @returns {{ missing: string[], unexpected: string[] }}
 */
export function comparePack(packed, ruleFiles) {
  const expected = new Set([...REQUIRED_FILES, ...REQUIRED_PRESETS, ...ruleFiles])
  const actual = new Set(packed)

  const missing = [...expected].filter((file) => !actual.has(file)).sort()
  const unexpected = [...actual].filter((file) => !expected.has(file) && !ALLOWED_FILES.includes(file)).sort()
  return { missing, unexpected }
}

function packedFiles() {
  // `--ignore-scripts` keeps lifecycle output (prepack, ...) out of stdout so it
  // stays valid JSON. On Windows npm is a .cmd shim and needs a shell.
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  })
  const start = stdout.indexOf('[')
  if (start === -1) throw new Error(`npm pack did not print a JSON report:\n${stdout}`)
  const [report] = JSON.parse(stdout.slice(start))
  return { name: `${report.name}@${report.version}`, size: report.size, files: report.files.map((file) => file.path) }
}

function ruleFilesOnDisk() {
  return readdirSync(join(ROOT, 'rules'))
    .filter((file) => file.endsWith('.grit'))
    .map((file) => `rules/${file}`)
    .sort()
}

function main() {
  const pack = packedFiles()
  const ruleFiles = ruleFilesOnDisk()
  const { missing, unexpected } = comparePack(pack.files, ruleFiles)

  if (process.argv.includes('--list') || missing.length > 0 || unexpected.length > 0) {
    console.log(`${pack.name} (${pack.files.length} files, ${pack.size} bytes packed):`)
    for (const file of [...pack.files].sort()) console.log(`  ${file}`)
    console.log()
  }

  if (missing.length === 0 && unexpected.length === 0) {
    console.log(`✔ tarball contents OK: ${pack.files.length} files (${ruleFiles.length} GritQL plugins).`)
    return
  }

  console.error('✖ unexpected tarball contents')
  for (const file of missing) {
    const hint = REQUIRED_PRESETS.includes(file)
      ? ' (generated preset: run `npm run build`)'
      : existsSync(join(ROOT, file))
        ? ' (exists on disk: check the "files" field in package.json / .npmignore)'
        : ' (missing from the repository)'
    console.error(`  - ${file}${hint}`)
  }
  for (const file of unexpected) {
    console.error(`  + ${file} (must not be published: narrow the "files" field in package.json)`)
  }
  process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
