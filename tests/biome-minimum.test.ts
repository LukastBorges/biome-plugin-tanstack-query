import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { currentMapping } from '../scripts/sync-version.js'
import { ROOT } from './helpers/biome'

const read = (file: string) => JSON.parse(readFileSync(join(ROOT, file), 'utf8'))

it('the CI lockfile for the minimum Biome version matches the peerDependencies floor', () => {
  const { biome: floor } = currentMapping(read('package.json'))
  const manifest = read('.github/biome-minimum/package.json')
  const lock = read('.github/biome-minimum/package-lock.json')
  const hint = 'update .github/biome-minimum/package.json and run `npm install --package-lock-only` there'
  expect(manifest.devDependencies['@biomejs/biome'], hint).toBe(floor)
  expect(lock.packages['node_modules/@biomejs/biome'].version, hint).toBe(floor)
})
