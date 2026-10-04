# Contributing

Thanks for helping! This repository ports the rules of
[`@tanstack/eslint-plugin-query`](https://tanstack.com/query/latest/docs/eslint/eslint-plugin-query)
to [Biome](https://biomejs.dev) [GritQL plugins](https://biomejs.dev/linter/plugins/).
The published npm package contains nothing but `.grit` files, `README.md` and
`LICENSE`; everything else in the repository exists to test and release them.

By participating you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).
Security issues: see [SECURITY.md](./SECURITY.md), never a public issue.

## Development setup

Requirements: Node.js `^22.12.0 || >=24` (see `.nvmrc`; enforced through
`devEngines`) and npm >= 10.9.

```sh
git clone https://github.com/LukastBorges/biome-plugin-tanstack-query.git
cd biome-plugin-tanstack-query
npm ci          # exact lockfile install; install scripts are disabled in .npmrc
npm run check   # everything CI runs: lint, typecheck, presets, tests, tarball
```

| Script                   | What it does                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `npm test`               | Runs the vitest suite: the real Biome CLI against every rule's fixtures.                        |
| `npx vitest run -t <rule>` | Only the tests of one rule, e.g. `-t no-rest-destructuring`.                                  |
| `npm run build`          | Regenerates the presets `rules/index.grit` and `rules/recommended-strict.grit`.                |
| `npm run check:index`    | Fails if the committed presets are stale.                                                       |
| `npm run lint` / `lint:fix` | Biome on the repository's own code (fixtures are excluded).                                  |
| `npm run typecheck`      | `tsc --noEmit` over the tests.                                                                  |
| `npm run pack:check`     | Asserts the npm tarball contains exactly `package.json`, `README.md`, `LICENSE`, `rules/*.grit`. |
| `npm run check:upstream` | Compares the mirrored upstream version with npm (`--dry-run` to only print the report).        |
| `npm run lint:commits`   | Lints the commit messages of your branch (since `origin/main`).                                |

## Repository layout

```text
rules/<rule>.grit              one standalone Biome plugin per upstream rule (hand-written)
rules/index.grit               GENERATED "recommended" preset (all rules composed)
rules/recommended-strict.grit  GENERATED "recommended-strict" preset
scripts/build-index.js         generates the presets; defines which rule is in which preset
tests/fixtures/<rule>/         valid.tsx, invalid.tsx (+ optional expected fix outputs)
tests/plugin.test.ts           the suite (runs Biome per fixture in an isolated temp project)
docs/rules/<rule>.md           per-rule documentation, linked from the README
```

Biome loads exactly **one top-level pattern per `.grit` file** and a plugin
cannot import patterns from another file. That is why the presets are
*generated*: `scripts/build-index.js` concatenates the pattern definitions of
every rule file and calls all entry points inside one `any { ... }`, grouped by
the node kind each rule anchors on. Never edit
`rules/index.grit` or `rules/recommended-strict.grit` by hand; run
`npm run build` and commit the result (CI fails otherwise).

## Porting or changing a rule

### 1. The rule file: `rules/<rule-name>.grit`

`<rule-name>` is the upstream rule name, e.g. `no-rest-destructuring`. The file
must follow this contract (enforced by `extractDefinitions` in
`scripts/build-index.js` and by the test suite):

```grit
// @tanstack/query/<rule-name>
// Upstream: https://tanstack.com/query/latest/docs/eslint/<rule-name>
// 2-6 lines: what it flags and the main limitations vs the ESLint rule.
language js

pattern tanstack_query_<rule_name>() {
  ...
}

// Helpers MUST be prefixed with the entry point name so they cannot collide
// with other rules once composed into a preset:
pattern tanstack_query_<rule_name>_<helper>() { ... }

and { JsCallExpression(), tanstack_query_<rule_name>() }
```

- The entry point is `tanstack_query_` + the rule name with `-` replaced by `_`.
- The **last line** must be `and { <Anchor>, tanstack_query_<rule_name>() }`,
  where `<Anchor>` is the node kind the entry point matches (`JsCallExpression()`)
  or `or { JsA(), JsB() }` when it matches several kinds. Biome evaluates the
  top-level pattern on every node of a file; the bare kind check lets it reject
  almost all of them cheaply, and the presets dispatch rules by anchor. This
  made the recommended preset about 5x faster on Biome 2.5.15. An anchor that
  misses a node kind the rule reports on silently drops those findings, and the
  fixture tests catch that.
- Every `pattern` / `predicate` / `function` must be named
  `tanstack_query_<rule_name>` or `tanstack_query_<rule_name>_<anything>`.

### 2. Diagnostics

- Messages start with `@tanstack/query/<rule-name>: ` followed by the upstream
  ESLint message (verbatim where possible). The test harness parses this
  prefix to attribute diagnostics to rules.
- Severity mirrors the upstream `recommended` config: `severity="warn"` for
  `no-rest-destructuring`, an explicit `severity="error"` for every other rule.
- **Span ownership.** Biome keeps only the first diagnostic per identical span
  within one plugin file, so two rules reporting the same node would hide each
  other inside a preset. Report on the most specific node that explains the
  problem (a property, a binding, an argument), never on a whole hook call or
  options object unless your rule is the only one that can own it.
- Fixes: a rewrite (`$node => \`...\``) in the same `where` clause becomes the
  fix. Pass `fix_kind="safe"` only if the rewrite can never change runtime
  behaviour; otherwise leave it unsafe (applied with `--write --unsafe`).
  Known Biome bug: rewrite templates containing a function with a parameter
  list (`() => x`, `function () {}`) currently panic the linter.

Suppressions work per plugin file: `// biome-ignore lint/plugin/<rule-name>: reason`
for a standalone rule, `// biome-ignore lint/plugin: reason` for any plugin.

### 3. Fixtures: `tests/fixtures/<rule-name>/`

| File                       | Required | Meaning                                                                                 |
| -------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `valid.tsx`                | yes      | Must produce **zero** diagnostics. Must not contain any `expect:` comment.              |
| `invalid.tsx`              | yes      | Every expected diagnostic is annotated (see below); nothing else may be reported.       |
| `invalid.fixed.tsx`        | no       | Exact expected output of `biome lint --write` (safe fixes only).                        |
| `invalid.unsafe-fixed.tsx` | no       | Exact expected output of `biome lint --write --unsafe`.                                 |

If neither fixed file exists, the suite asserts that `--write` changes nothing.

Annotate the line on which the diagnostic **starts** (start line of the
reported span):

```tsx
const { data, ...rest } = useQuery(opts) // expect: no-rest-destructuring
<Foo query={useQuery(opts)} />          {/* expect: rule-name */}
const a = useQuery(x), b = useQuery(y)  // expect: rule-name, rule-name
```

Repeat the rule name, comma-separated, for several diagnostics on one line.
Port the upstream rule's test cases (from the TanStack repository) as faithfully
as GritQL allows, and add regression cases for every false positive/negative
you fix. Fixtures are compared byte-for-byte; `.editorconfig` and
`.gitattributes` keep editors and Git from touching them.

### 4. Register the rule

- Add it to the `recommended` and/or `recommended-strict` lists in
  `PRESETS` (`scripts/build-index.js`), mirroring the upstream configs.
- Add it to `UPSTREAM_RULES` in `tests/plugin.test.ts` with its upstream
  severity.
- `npm run build`, then commit the regenerated presets.

### 5. Document it: `docs/rules/<rule-name>.md`

Describe what the rule flags, correct/incorrect examples, which fixes it
applies, and, importantly, **how it differs from the ESLint rule** (no type
information, no cross-file or full scope analysis, ...). Link it from the rules
table in the README.

### Exploring GritQL

Probe patterns outside the repository so you don't pollute it:

```sh
mkdir -p /tmp/probe && cd /tmp/probe
echo '{ "root": true, "plugins": ["/path/to/biome-plugin-tanstack-query/rules/<rule>.grit"] }' > biome.json
$OLDPWD/node_modules/.bin/biome lint --reporter=json sample.tsx
```

Biome CST node names (`JsCallExpression`, `JsObjectBindingPatternRest`, ...) and
their fields come from Biome's grammar,
[`xtask/codegen/js.ungram`](https://github.com/biomejs/biome/blob/main/xtask/codegen/js.ungram).
Always verify a construct with a probe before relying on it.

### Testing against another Biome version

CI runs the suite against the minimum supported Biome version (the
`peerDependencies` floor) and the latest release. To do the same locally:

```sh
npm install --no-save @biomejs/biome@2.5.2   # lockfile stays untouched
npm test
npm ci                                       # back to the locked version
```

Alternatively, point `BIOME_PLUGIN_TEST_BIN` at another install's
`node_modules/@biomejs/biome/bin/biome` script. Do **not** use `BIOME_BINARY`
for this: Biome's npm launcher reads that variable as the path of the native
executable and would re-spawn itself endlessly (the test harness strips it from
the environment for that reason).

If a change needs a newer Biome, raise the `peerDependencies` floor in the same
pull request (that is a breaking change for users, see below).

## Commit messages and pull requests

This project uses [Conventional Commits](https://www.conventionalcommits.org/)
because releases are fully automated: the commit type decides the next
version. Pull requests are **squash-merged**, so the **PR title** is what
counts; CI lints it with commitlint (`commitlint.config.js`).

```text
<type>(<optional scope>)<optional !>: <description>
```

| Commit                                                  | Release |
| ------------------------------------------------------- | ------- |
| `feat(<rule>): ...` new rule, new detection             | minor   |
| `fix(<rule>): ...` false positive/negative, wrong fix   | patch   |
| `perf: ...`, `refactor(rules): ...`, `refactor(presets): ...` | patch |
| `chore(upstream): mirror @tanstack/eslint-plugin-query 5.x.y` | patch |
| `docs(readme): ...` (the README ships in the package)   | patch   |
| `feat!: ...` or a `BREAKING CHANGE:` footer             | major   |
| `docs`, `test`, `ci`, `build`, `chore`, `chore(deps-dev)`, `ci(deps)`, `style` | none |

Scopes are optional but, when present, must be a rule name or one of `rules`,
`presets`, `upstream`, `biome`, `deps`, `deps-dev`, `ci`, `docs`, `readme`,
`tests`, `scripts`, `release`.

**Breaking changes** for users include: removing a rule or a preset file,
renaming a file under `rules/` (it breaks their `biome.json` path), raising the
minimum Biome version, and making a rule report substantially more code.

## Keeping up with upstream

`.github/workflows/upstream-check.yml` runs `scripts/check-upstream.js` daily
and opens an `upstream-sync` issue when a new
`@tanstack/eslint-plugin-query` release appears, listing new, removed and
changed rules. To sync:

1. Port the changes (new rules, behaviour changes, preset changes).
2. Bump `upstream.version` in `package.json`, run `npm run version:sync` (adds an
   "unreleased" row to the README compatibility matrix; the release turns it
   into "`X.Y.Z` and later").
3. Open a PR titled `feat(upstream): ...` (new rules or detections) or
   `chore(upstream): mirror @tanstack/eslint-plugin-query x.y.z` (version bump only).

## Releases (maintainers)

Releases are cut by [semantic-release](https://semantic-release.gitbook.io/)
(`.releaserc.json`) from `.github/workflows/release.yml` on every push to
`main` (stable, `latest` dist-tag) and `next` (prereleases, `next` dist-tag),
after the full CI suite passed on that commit. It analyses the commits since
the last tag, bumps the version, updates `CHANGELOG.md` (repository only; not
published), publishes to npm, commits `chore(release): x.y.z [skip ci]`, tags
`vx.y.z` and creates a GitHub release. Nobody runs `npm publish` by hand.

One-time setup:

1. **npm Trusted Publishing.** npm can only attach a trusted publisher to an
   existing package, so bootstrap the first release with a short-lived
   [granular access token](https://docs.npmjs.com/creating-and-viewing-access-tokens)
   stored as the `NPM_TOKEN` repository secret. Then, on npmjs.com >
   package > Settings > Trusted publishing, add GitHub Actions with
   repository `LukastBorges/biome-plugin-tanstack-query`, workflow
   `release.yml` and environment `npm`; delete the `NPM_TOKEN` secret and set
   Publishing access to "Require two-factor authentication and disallow
   tokens". From then on every release authenticates through OIDC and gets a
   provenance attestation automatically.
2. **Environment** `npm` (Settings > Environments): restrict deployment
   branches to `main` and `next`.
3. **Branch protection / rulesets** on `main`: require the CI checks and the
   PR title check. Because semantic-release pushes the release commit and tag
   with the workflow's `GITHUB_TOKEN`, allow GitHub Actions to bypass the
   "require a pull request" rule (or use a GitHub App token), otherwise the
   release fails when @semantic-release/git pushes (before anything is
   published).
4. Enable **private vulnerability reporting** and Dependabot security updates
   (Settings > Code security).

Users can verify a release with `npm audit signatures` (see
[SECURITY.md](./SECURITY.md#verifying-what-you-install)).
