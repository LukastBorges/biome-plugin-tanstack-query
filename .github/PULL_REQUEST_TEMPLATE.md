<!--
The PR title becomes the squash-merge commit and decides the next release.
Use Conventional Commits, e.g.:
  feat(no-rest-destructuring): flag rest destructuring of useQueries results
  fix(stable-query-client): ignore QueryClient created in module scope
See CONTRIBUTING.md > Commit messages and pull requests.
-->

## What and why

<!-- What does this change, and which issue does it close? -->

Closes #

## How it was verified

<!-- e.g. new fixture cases, comparison with @tanstack/eslint-plugin-query on the same code -->

## Checklist

- [ ] The PR title follows Conventional Commits (`feat`, `fix`, `!` for breaking changes, ...)
- [ ] `npm run check` passes locally (lint, typecheck, presets, tests, tarball)
- [ ] Rule changes come with fixture cases in `tests/fixtures/<rule>/` (`// expect: <rule>` on the start line of each diagnostic)
- [ ] Presets regenerated with `npm run build` if any `rules/*.grit` changed
- [ ] `docs/rules/<rule>.md` (and the README, if user-facing) updated, including limitations vs. the ESLint rule
- [ ] Diagnostics keep the `@tanstack/query/<rule>: ` prefix, the upstream message and severity, and report on a span no other rule owns
