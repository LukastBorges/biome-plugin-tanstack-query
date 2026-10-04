import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listRuleFiles, PRESETS } from '../scripts/build-index.js'
import { currentMapping, syncReadme } from '../scripts/sync-version.js'
import { ROOT } from './helpers/biome'

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

describe('README.md', () => {
  it('compatibility matrix is in sync with package.json (`npm run version:sync`)', () => {
    expect(syncReadme(readme, currentMapping(pkg))).toBe(readme)
  })

  it('documents every rule and links its docs page', () => {
    for (const rule of listRuleFiles()) {
      expect(readme).toContain(`[\`${rule}\`](docs/rules/${rule}.md)`)
    }
  })

  it('shows the exact node_modules paths of the shipped presets', () => {
    for (const preset of Object.keys(PRESETS)) {
      expect(readme).toContain(`"./node_modules/biome-plugin-tanstack-query/rules/${preset}.grit"`)
    }
  })
})
