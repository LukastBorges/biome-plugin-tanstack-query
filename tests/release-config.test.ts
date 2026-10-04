import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from './helpers/biome'

// Runs the commit-analyzer and release-notes-generator steps of the real
// .releaserc.json, so incompatible changelog tooling (e.g. a preset major that
// needs a newer conventional-changelog-writer than semantic-release bundles)
// fails CI instead of the release job.
const require = createRequire(join(ROOT, 'package.json'))
const config = JSON.parse(readFileSync(join(ROOT, '.releaserc.json'), 'utf8'))
const options = (name: string) =>
  config.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === name)[1]

const context = {
  cwd: ROOT,
  env: {},
  logger: { log() {}, warn() {}, error() {} },
  options: { repositoryUrl: 'https://github.com/LukastBorges/biome-plugin-tanstack-query.git' },
  lastRelease: {},
  nextRelease: { version: '1.0.0', gitTag: 'v1.0.0' },
  commits: [
    { hash: 'a1', message: 'feat: add a rule' },
    { hash: 'b2', message: 'fix(rules): avoid a false positive' },
    { hash: 'c3', message: 'chore(upstream): sync with a new release' },
    { hash: 'd4', message: 'ci: tweak a workflow' },
  ],
}

describe('.releaserc.json', () => {
  it('analyzes commits with the configured release rules', async () => {
    const { analyzeCommits } = await import(require.resolve('@semantic-release/commit-analyzer'))
    expect(await analyzeCommits(options('@semantic-release/commit-analyzer'), context)).toBe('minor')
  })

  it('renders release notes with the configured preset', async () => {
    const { generateNotes } = await import(require.resolve('@semantic-release/release-notes-generator'))
    const notes: string = await generateNotes(options('@semantic-release/release-notes-generator'), context)
    expect(notes).toContain('### Features')
    expect(notes).toContain('### Bug Fixes')
    expect(notes).toContain('### Upstream Sync')
    expect(notes).not.toContain('tweak a workflow')
  })
})
