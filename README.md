# biome-plugin-tanstack-query

[![CI](https://github.com/LukastBorges/biome-plugin-tanstack-query/actions/workflows/ci.yml/badge.svg)](https://github.com/LukastBorges/biome-plugin-tanstack-query/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/biome-plugin-tanstack-query)](https://www.npmjs.com/package/biome-plugin-tanstack-query)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/LukastBorges/biome-plugin-tanstack-query/badge)](https://scorecard.dev/viewer/?uri=github.com/LukastBorges/biome-plugin-tanstack-query)

The rules of [`@tanstack/eslint-plugin-query`](https://tanstack.com/query/latest/docs/eslint/eslint-plugin-query), ported to [Biome](https://biomejs.dev) as [GritQL plugins](https://biomejs.dev/linter/plugins/).

```text
src/App.tsx:4:41 plugin ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × @tanstack/query/exhaustive-deps: The following dependencies are missing in your queryKey: id

    3 │ export function App({ id }: { id: string }) {
  > 4 │   const { data } = useQuery({ queryKey: ['todo'], queryFn: () => fetchTodo(id) })
      │                                         ^^^^^^^^
```

## Why this exists

Teams that move from ESLint to Biome lose the TanStack Query lint rules. Those rules catch real bugs: query keys that miss a dependency and serve stale data, a `QueryClient` rebuilt on every render, and destructuring that re-renders on every change.

Biome does not run ESLint plugins. It does run plugins written in [GritQL](https://docs.grit.io/language/overview), a structural pattern language. This package reimplements each upstream rule in GritQL. It is tested against the upstream rule's own test cases, and every gap is documented instead of hidden.

## Compatibility

| `biome-plugin-tanstack-query` | Mirrors `@tanstack/eslint-plugin-query` | Requires `@biomejs/biome` |
| ----------------------------- | --------------------------------------- | ------------------------- |
| `1.0.0` and later | `5.104.1` | `>= 2.5.2` |

- Each row covers the plugin releases that mirror the same upstream version. The table is updated automatically on every release (`scripts/sync-version.js`).
- The mirrored version is recorded in [`package.json#upstream`](package.json). A [daily job](.github/workflows/upstream-check.yml) opens an issue when TanStack publishes a newer release, with a diff of new, removed and changed rules (see [Staying in sync](#staying-in-sync-with-upstream)).
- **Biome 2.5.2** is the tested minimum. CI runs the full suite against that version and against the latest Biome release (the exact dev dependency, kept current by Dependabot). In 2.5.0 and 2.5.1 several rules fail to compile, and earlier versions cannot express plugin fixes.

## Installation

```sh
npm install --save-dev @biomejs/biome biome-plugin-tanstack-query
# pnpm add -D @biomejs/biome biome-plugin-tanstack-query
# yarn add -D @biomejs/biome biome-plugin-tanstack-query
# bun add -d @biomejs/biome biome-plugin-tanstack-query
```

## Configuration

Biome's `plugins` option takes **file paths, not package names**, so you point it at the `.grit` file inside `node_modules`. The path is relative to your `biome.json`.

### Recommended (mirrors `plugin:@tanstack/query/recommended`)

```jsonc
// biome.json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "plugins": ["./node_modules/biome-plugin-tanstack-query/rules/index.grit"]
}
```

Then lint as usual:

```sh
npx biome lint .          # or: npx biome check .
```

### Strict (mirrors `plugin:@tanstack/query/recommended-strict`)

This preset adds `prefer-query-options` to the recommended rules:

```json
{
  "plugins": ["./node_modules/biome-plugin-tanstack-query/rules/recommended-strict.grit"]
}
```

### Pick individual rules

Every rule is also published as its own plugin file:

```json
{
  "plugins": [
    "./node_modules/biome-plugin-tanstack-query/rules/exhaustive-deps.grit",
    "./node_modules/biome-plugin-tanstack-query/rules/stable-query-client.grit",
    "./node_modules/biome-plugin-tanstack-query/rules/no-rest-destructuring.grit"
  ]
}
```

Use **either** a preset **or** individual files for a given rule, not both. Otherwise the rule runs twice and every finding is reported twice.

### Limit the plugin to some files

Biome 2.5 accepts an object form with `includes` globs:

```json
{
  "plugins": [
    {
      "path": "./node_modules/biome-plugin-tanstack-query/rules/index.grit",
      "includes": ["src/**/*.{ts,tsx}", "!**/*.test.tsx"]
    }
  ]
}
```

### Package-manager notes

- **npm, pnpm, Bun, and Yarn with `nodeLinker: node-modules`:** the path above works when the package is a direct dependency of the project that holds `biome.json`. pnpm symlinks direct dependencies into `node_modules`.
- **Monorepos:** install the package in the workspace that holds the `biome.json` which declares the plugin. Usually that is the root.
- **Yarn Plug'n'Play:** packages stay inside zip archives, so Biome cannot read the `.grit` files. Set `nodeLinker: node-modules` in `.yarnrc.yml`, or vendor the `.grit` files into your repository.

## Rules

| Rule | Preset | Severity | Port status | `--write` fix |
| ---- | ------ | -------- | ----------- | ------------- |
| [`exhaustive-deps`](docs/rules/exhaustive-deps.md) | recommended | error | partial (structural scope analysis) | — |
| [`infinite-query-property-order`](docs/rules/infinite-query-property-order.md) | recommended | error | partial (ordering logic complete) | ✅ safe |
| [`mutation-property-order`](docs/rules/mutation-property-order.md) | recommended | error | full | ✅ safe |
| [`no-rest-destructuring`](docs/rules/no-rest-destructuring.md) | recommended | warn | partial (no typed mode) | — |
| [`no-unstable-deps`](docs/rules/no-unstable-deps.md) | recommended | error | partial (all upstream cases pass) | — |
| [`no-void-query-fn`](docs/rules/no-void-query-fn.md) | recommended | error | partial (structural, no type checker) | — |
| [`stable-query-client`](docs/rules/stable-query-client.md) | recommended | error | partial (narrower than upstream) | — |
| [`prefer-query-options`](docs/rules/prefer-query-options.md) | recommended-strict | error | partial (all upstream cases pass) | — |

- Severities match the upstream presets.
- **Full** means detection parity with the upstream rule.
- **Partial** means the rule handles the common cases, and probably the bugs you care about, but it lacks information ESLint has: types or complete scope analysis. Each rule's page lists exactly what it does and does not detect, with code examples.
- Upstream offers fixes for the two property-order rules, and editor *suggestions* for `stable-query-client` and `exhaustive-deps`. This port only ships fixes it can prove safe, so the last two are report-only (see their docs).

Every message starts with the upstream rule ID, for example `@tanstack/query/exhaustive-deps: …`, so findings are easy to search for and to map to the TanStack docs.

## What this plugin does *not* do

GritQL plugins match the **shape of the syntax tree**. ESLint rules can also ask the TypeScript type checker and ESLint's scope manager. That difference sets the limits below:

- **No type information.**
  - `no-void-query-fn` infers return types from the code's structure: annotations, `return` statements and concise arrow bodies. It cannot see the return type of an imported function or of a call.
  - `no-rest-destructuring` cannot recognise *custom hooks* that return a query result. That is upstream's typed-linting mode.
- **Approximate scope analysis.**
  - `exhaustive-deps` resolves variables by name inside the enclosing function. Member paths are compared by their root, so `state.foo` in the key covers `state.bar`.
  - A same-named binding inside the `queryFn` hides the outer variable. Keys that come from parameters, imports or destructuring are skipped.
  - When in doubt, the rules choose silence over a false positive.
- **Single-file analysis.** Re-exports and wrapper hooks defined in other modules are invisible. Import detection generally requires a named import from an `@tanstack/*-query` package; the rule docs say which rules mirror upstream's lack of an import check.
- **No rule options.** Biome plugins cannot take options, so `exhaustive-deps`'s `allowlist` is not available. Use a suppression comment instead (below).
- **Severity is fixed.** `biome.json` cannot change the severity of a plugin diagnostic. Use `includes` to scope a plugin, or pick individual rule files, to control what runs.
- **Diagnostics are categorized as `plugin`**, not under a `lint/...` rule name. This is how all Biome plugins work today.
- **No `.vue` SFC top-level checks.** Biome lints `<script>` blocks of `.vue` and `.svelte` files. Queries inside functions are checked; top-level `<script setup>` code is not, for `exhaustive-deps`.

### Fixes in the presets (Biome 2.5 behavior)

Biome 2.5 attaches **all rewrites of one plugin file to the first diagnostic that file reports in a source file**. With a preset, that first diagnostic may belong to a rule without a fix. Then:

- `biome lint --write` may skip the property-order fixes in that source file.
- **`biome lint --write --unsafe` applies them.** The only rewrites this package ships are the safe property-order swaps.
- Biome's `FIXABLE` marker can appear on another rule's diagnostic.
- A violation you suppressed with `biome-ignore` can still be rewritten when an earlier, unsuppressed violation in the same file carries the bundled fix.

None of this happens when you list the property-order rules as **individual plugin files**. The test suite pins both behaviors, so this section stays accurate until Biome changes.

## Suppressing a finding

Suppression comments use `lint/plugin/<plugin file name without .grit>`:

```ts
// With a preset (rules/index.grit):
// biome-ignore lint/plugin/index: the key is built by a factory that already includes `id`
const query = useQuery({ queryKey: todoKeys.detail(), queryFn: () => fetchTodo(id) })

// With individual rule files:
// biome-ignore lint/plugin/exhaustive-deps: the key is built by a factory that already includes `id`
const query = useQuery({ queryKey: todoKeys.detail(), queryFn: () => fetchTodo(id) })

// Any plugin:
// biome-ignore lint/plugin: <reason>
```

With a preset, `lint/plugin/index` (or `lint/plugin/recommended-strict`) silences every rule of the preset on that line. To suppress one specific rule, load that rule as an individual file.

## Performance

### Compared with ESLint

[`scripts/benchmark.js`](scripts/benchmark.js) lints the same generated codebase with ESLint and with Biome:

- **Corpus:** realistic React + TanStack Query components, hooks, infinite lists, mutations and utility modules. 15% of the files contain one known violation.
- **ESLint side:** `@tanstack/eslint-plugin-query` at the mirrored version, with its `flat/recommended` config.
- **Biome side:** this plugin.
- **Timing:** each configuration is timed end to end, from process start to the JSON report on disk. Figures are the median of 5 runs after a warm-up.

Apple M2 Max (12 threads), Node 24.11.1, Biome 2.5.15, ESLint 10.12.0, typescript-eslint 8.71.0, TypeScript 6.0.3:

| Configuration | 300 files (20k lines) | 1,000 files (68k lines) |
| ------------- | --------------------: | ----------------------: |
| ESLint + plugin, typed (`projectService`) | 1.63 s | 3.55 s |
| ESLint + plugin, typed, `--concurrency=auto` | 1.90 s | 3.01 s |
| ESLint + plugin, untyped | 0.92 s | 2.08 s |
| ESLint + plugin, untyped, `--concurrency=auto` | 1.05 s | 1.47 s |
| **Biome + `index.grit`** | **0.37 s** | **1.17 s** |
| **Biome + the 7 recommended rules as individual files** | **0.16 s** | **0.43 s** |
| *Reference: Biome without plugins* | *0.05 s* | *0.09 s* |
| *Reference: ESLint, parser only* | *0.84 s* | *1.87 s* |

The findings match:

- On both corpus sizes, Biome found exactly what **typed** ESLint found, on every injected violation and every rule.
- Untyped ESLint misses every `no-void-query-fn` case, because that rule needs type information. A like-for-like comparison is therefore against the typed runs.
- Against typed ESLint, Biome with `index.grit` is about **2.6–4.4× faster**, and Biome with individual rule files about **7–10× faster**.

Read these numbers with care:

- **The GritQL plugins account for most of Biome's time.** Biome's built-in pipeline is roughly 17× faster than ESLint's here. Once the plugins run, the lead over the fastest *untyped* ESLint shrinks: at 1,000 files it is 1.3× with `index.grit` and 3.4× with individual files.
- **The corpus was generated from patterns this port handles.** On real code with the edge cases each [rule page](docs/rules/) lists, ESLint with type information finds things this port cannot.
- **Reproduce the runs:** `npm run bench -- --files 1000`. Other flags are `--runs`, `--seed`, `--no-typed` and `--json`. The ESLint toolchain is pinned and installed into `.bench/` (gitignored) on first use.

### Presets vs. individual rule files

In Biome 2.5, every GritQL variable declared anywhere in a plugin file adds a cost to every node visit, so a combined preset costs more than the sum of its rules. To soften that:

- each rule's entry point first checks the syntax node kind it anchors on, such as `JsCallExpression`;
- the presets group rules by that anchor, so most nodes are rejected after one cheap check.

The preset is still about 2.7× slower than listing the same rules as individual files. On large codebases, prefer the individual files:

```json
{
  "plugins": [
    "./node_modules/biome-plugin-tanstack-query/rules/exhaustive-deps.grit",
    "./node_modules/biome-plugin-tanstack-query/rules/infinite-query-property-order.grit",
    "./node_modules/biome-plugin-tanstack-query/rules/mutation-property-order.grit",
    "./node_modules/biome-plugin-tanstack-query/rules/no-rest-destructuring.grit",
    "./node_modules/biome-plugin-tanstack-query/rules/no-unstable-deps.grit",
    "./node_modules/biome-plugin-tanstack-query/rules/no-void-query-fn.grit",
    "./node_modules/biome-plugin-tanstack-query/rules/stable-query-client.grit"
  ]
}
```

This list is exactly the `recommended` preset. It also avoids the [preset fix caveat](#fixes-in-the-presets-biome-25-behavior) and allows per-rule suppressions. `prefer-query-options`, the extra rule in `recommended-strict.grit`, is the most expensive rule.

## Troubleshooting

### VS Code shows "Notify file events failed: Client is not running (-32096)"

This popup comes from the Biome VS Code extension, not from this plugin. The extension restarts its language server whenever a lockfile (`package-lock.json`, `bun.lock`, …) or `biome.json` changes. While it restarts, VS Code keeps sending file-change events, and each one fails with this error. Linting keeps working. The popup shows up after every `npm install` / `bun add`, with or without plugins.

To make it rarer or hide it:

- **Hide the popup.** Turn off notifications for the Biome extension with the gear icon on the notification. The errors still go to the Biome output channel.
- **Batch dependency changes.** Each install rewrites the lockfile and triggers one restart.
- **Close the lockfile tab during installs.** An open lockfile gets diagnosed again after every restart, which adds more errors to the log.
- **Stop leftover Biome servers after upgrading Biome.** Run `pkill -f "biome __run_server"`, then **Developer: Reload Window**.
- **Close other Biome workspaces you don't need.** VS Code windows using the same Biome version share one Biome server, so a restart in one window also hits the others.

## Supply-chain security

- Releases are built and published only from [GitHub Actions](.github/workflows/release.yml) through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no long-lived tokens), with [provenance](https://docs.npmjs.com/generating-provenance-statements) linking each tarball to the commit and workflow run that built it. To verify your installed copy:

  ```sh
  npm audit signatures
  ```

- Every [GitHub release](https://github.com/LukastBorges/biome-plugin-tanstack-query/releases) carries the published tarball and its Sigstore-signed SLSA provenance (`.tgz.sigstore.json`, `.intoto.jsonl`), so you can verify a download without npm:

  ```sh
  cosign verify-blob-attestation \
    --bundle biome-plugin-tanstack-query-1.0.0.tgz.sigstore.json \
    --type slsaprovenance1 \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    --certificate-identity https://github.com/LukastBorges/biome-plugin-tanstack-query/.github/workflows/release.yml@refs/heads/main \
    biome-plugin-tanstack-query-1.0.0.tgz
  ```

- The tarball contains only `rules/*.grit`, `README.md`, `LICENSE` and `package.json`. There is no JavaScript, and there are no install scripts and no dependencies. CI enforces this with [`scripts/check-pack.js`](scripts/check-pack.js).
- Actions in the workflows are pinned to commit SHAs and updated by Dependabot. CodeQL scans the scripts and the workflows, and the [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/LukastBorges/biome-plugin-tanstack-query) runs weekly.
- Known advisories in development-only release tooling that have no upstream fix are triaged, with reasons and expiry dates, in [`osv-scanner.toml`](osv-scanner.toml).
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Staying in sync with upstream

[`scripts/check-upstream.js`](scripts/check-upstream.js) runs daily via [`upstream-check.yml`](.github/workflows/upstream-check.yml). When npm has a newer `@tanstack/eslint-plugin-query`, the script:

- downloads both tarballs and verifies their integrity;
- diffs new, removed and changed rules, and changes to the `recommended` / `recommended-strict` presets;
- opens a single `upstream-sync` issue per release, with a maintainer checklist.

Run it locally:

```sh
npm run check:upstream -- --dry-run                    # "up to date", or the issue it would open
npm run check:upstream -- --dry-run --current 5.91.0   # preview the diff from an older baseline
```

## How it is tested

[`tests/plugin.test.ts`](tests/plugin.test.ts) runs the real Biome CLI against each rule's fixtures in an isolated temporary project. It parses Biome's JSON report.

- **Annotations:** every line of `tests/fixtures/<rule>/invalid.tsx` that should produce a diagnostic carries a `// expect: <rule>` comment. The suite asserts the exact set of reported lines, the upstream severity, and zero diagnostics on `valid.tsx`.
- **Fixes:** the suite compares the output of `--write` and `--write --unsafe` against `invalid.fixed.tsx` (or asserts that nothing is rewritten).
- **Presets:** each rule is checked again inside both presets, to prove that composition hides nothing.
- **Upstream cases:** the fixtures port the upstream ESLint test suites wherever GritQL can express them. Each rule's doc lists the cases it skips.

```sh
npm ci
npm test
```

## Contributing

Contributions are welcome, especially false-positive reports (there is an issue template for them). [CONTRIBUTING.md](CONTRIBUTING.md) covers:

- the rule-file contract and how to port a rule;
- the GritQL-on-Biome pitfalls we found;
- how presets are generated;
- Conventional Commits and automated releases.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Credits & license

- The rules, messages and test cases are derived from [`@tanstack/eslint-plugin-query`](https://github.com/TanStack/query/tree/main/packages/eslint-plugin-query) by the TanStack team (MIT).
- This project is not affiliated with TanStack or Biome.

[MIT](LICENSE) © Lucas Borges
