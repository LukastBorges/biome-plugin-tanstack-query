// Conventional Commits for this repository. Releases are fully automated by
// semantic-release (see .releaserc.json), so the commit type decides the next
// version: feat -> minor, fix/perf/revert -> patch, `!` or BREAKING CHANGE ->
// major. Pull requests are squash-merged, so CI lints the PR title.
//
//   echo "feat(stable-query-client): flag QueryClient in custom hooks" | npx commitlint
//   npm run lint:commits   # every commit on the current branch since origin/main
import { readdirSync } from 'node:fs'

const rules = readdirSync(new URL('./rules/', import.meta.url))
  .filter((file) => file.endsWith('.grit') && file !== 'index.grit' && file !== 'recommended-strict.grit')
  .map((file) => file.slice(0, -'.grit'.length))

/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // A scope is optional; when present it must be one of these.
    'scope-enum': [
      2,
      'always',
      [
        // One scope per rule, e.g. `fix(no-rest-destructuring): ...`.
        ...rules,
        // Changes spanning several rules or the generated presets.
        'rules',
        'presets',
        // Syncing with a new @tanstack/eslint-plugin-query release.
        'upstream',
        // Biome compatibility (peer dependency range, new GritQL features).
        'biome',
        'deps',
        'deps-dev',
        'ci',
        'docs',
        'readme',
        'tests',
        'scripts',
        'release',
      ],
    ],
    // Dependabot and semantic-release bodies contain long URLs/changelogs.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
}
