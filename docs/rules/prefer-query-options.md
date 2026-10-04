# `@tanstack/query/prefer-query-options`

Prefer `queryOptions()` / `infiniteQueryOptions()` so that `queryKey` and `queryFn` always live together.

- Upstream rule: [`@tanstack/query/prefer-query-options`](https://tanstack.com/query/latest/docs/eslint/prefer-query-options) (mirrors `@tanstack/eslint-plugin-query@5.104.1`, `src/rules/prefer-query-options/prefer-query-options.rule.ts`)
- Plugin file: [`rules/prefer-query-options.grit`](../../rules/prefer-query-options.grit)
- Presets: `recommended-strict.grit` only. Upstream puts it in `recommended-strict` and not in `recommended`, so `index.grit` leaves it out too.

## Rule details

If `queryKey` and `queryFn` are written separately, the same key can end up used with more than
one `queryFn`, which causes hard-to-find cache bugs. Wrapping them in `queryOptions` (or
`infiniteQueryOptions`) keeps the key and the function together, and the result can be reused
anywhere. The rule reports:

1. Inline `queryKey` or `queryFn` properties passed to `useQuery`, `useInfiniteQuery`,
   `useSuspenseQuery`, `useSuspenseInfiniteQuery`, `usePrefetchQuery` or
   `usePrefetchInfiniteQuery`. This includes `{ ...options, queryKey: [...] }` overrides.
2. Inline query objects in the `queries` of `useQueries` / `useSuspenseQueries`, whether written
   as an array literal or returned from a `.map()` callback.
3. Inline `queryKey` / `queryFn` passed to the QueryClient methods `fetchQuery`, `prefetchQuery`,
   `fetchInfiniteQuery`, `prefetchInfiniteQuery`, `ensureQueryData` and `ensureInfiniteQueryData`.
4. A hand-typed array key, such as `['todos']`, `['todos'] as const` or
   `['todos'] satisfies QueryKey`. It is reported when passed as the key argument of
   `getQueryData`, `setQueryData`, `getQueryState`, `setQueryDefaults` or `getQueryDefaults`.
   It is also reported as the `queryKey` of the filters passed to `invalidateQueries`,
   `cancelQueries`, `refetchQueries`, `removeQueries`, `resetQueries`, `isFetching`,
   `getQueriesData`, `setQueriesData` and the `useIsFetching` hook.

Hooks and `useQueryClient` / `QueryClient` must be value imports from a `@tanstack/*-query`
package. That covers `react-query`, `vue-query`, `solid-query`, `svelte-query` and any other
adapter whose name ends in `-query`. Aliased imports are resolved, so
`import { useQuery as useTQ }` is checked. A QueryClient method is checked only when its receiver
is one of these:

- `useQueryClient()`
- `new QueryClient()`
- a variable initialised with one of the two

Examples of **incorrect** code:

```tsx
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query'

function Todo({ id, ids }) {
  // Reported on `useQuery`: "Prefer using queryOptions() or infiniteQueryOptions() to
  // co-locate queryKey and queryFn."
  const query = useQuery({
    queryKey: ['todo', id],
    queryFn: () => api.getTodo(id),
  })

  const todos = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['todo', id], // reported on this member, once per inline entry
      queryFn: () => api.getTodo(id),
    })),
  })

  const queryClient = useQueryClient()
  // Reported on `queryClient.getQueryData`: "Prefer referencing a queryKey from a
  // queryOptions() result instead of typing it manually."
  queryClient.getQueryData(['todo', id])
  // Same message, reported on the `queryKey: ['todo', id]` member.
  queryClient.invalidateQueries({ queryKey: ['todo', id] })
}
```

Examples of **correct** code:

```tsx
import { queryOptions, useQuery, useQueries, useQueryClient } from '@tanstack/react-query'

const todoOptions = (id) =>
  queryOptions({
    queryKey: ['todo', id],
    queryFn: () => api.getTodo(id),
  })

function Todo({ id, ids }) {
  const query = useQuery(todoOptions(id))
  const selected = useQuery({ ...todoOptions(id), select: (todo) => todo.title })
  const todos = useQueries({ queries: ids.map((id) => todoOptions(id)) })

  const queryClient = useQueryClient()
  queryClient.getQueryData(todoOptions(id).queryKey)
  queryClient.invalidateQueries({ queryKey: todoOptions(id).queryKey, exact: true })
}
```

### Where each diagnostic is reported

Every rule in the presets reports on a node of its own. Biome keeps only one diagnostic per span
in a plugin file, so two rules that reported on the same node would hide each other.

| Case | Span |
| --- | --- |
| Hook with inline `queryKey` / `queryFn` | the hook callee (`useQuery`) |
| QueryClient options / key methods | the callee (`queryClient.fetchQuery`) |
| Filter object of a QueryClient method or `useIsFetching` | the whole `queryKey: [...]` member |
| `useQueries` / `useSuspenseQueries` entry | see below |

A `useQueries` entry is reported on the first of these that it has:

1. a `queryKey: value` member (the whole member);
2. a `queryFn: value` or `queryFn() {}` member (the whole member);
3. a shorthand `queryKey` member;
4. otherwise (only a shorthand `queryFn`), the entry object itself.

`exhaustive-deps` reports on the queryKey *value*, and for a shorthand `{ queryKey }` that value is
the whole member. `no-void-query-fn` reports on the queryFn value, or on a shorthand `queryFn`
member. The order above keeps clear of both.

## Coverage vs. upstream

**Status: partial (structural approximation).** All 62 upstream test cases (16 valid, 46 invalid)
are ported to `tests/fixtures/prefer-query-options/` and pass. Each upstream case was also run
on its own, as a separate file, and gave exactly the upstream diagnostics. The fixtures also
cover Biome-specific shapes such as other adapters, parentheses, optional calls, type
assertions and nested conditional mappers. The ESLint rule uses scope analysis; this plugin uses
the structural approximations listed below.

What is detected, as upstream:

- Every hook, `useQueries` form and QueryClient method listed above.
- Shorthand (`{ queryKey }`) and method (`queryFn() {}`) members. Upstream treats these as
  ESTree `Property` nodes too.
- Aliased imports, combined `import X, { useQuery } from ...` clauses, and every
  `@tanstack/*-query` adapter.
- Explicit type arguments: `useQuery<Todo>({ ... })`, `queryClient.setQueryData<T>([...], x)`.
- QueryClient receivers wrapped in `as`, `satisfies`, `<T>` or parentheses.
- Optional calls such as `queryClient?.fetchQuery(...)`.
- Module-level, `export const` and function-local clients declared with `const`, `let` or `var`.
  They are resolved inside nested functions and callbacks such as
  `onSuccess: () => queryClient.invalidateQueries(...)`.
- `.map()` mappers whose receiver is parenthesized, such as `(data?.ids ?? []).map(...)`, and a
  parenthesized `queries` value.
- Shadowing. A same-named binding in an enclosing scope hides both the import and the client
  variable (this covers upstream's "shadowed queryClient parameter" case). These bindings count:
  - a parameter, including setter parameters
  - a catch binding or a `for` loop variable
  - a local `const` / `let` / `var` / `function` / `class` declaration in an enclosing function
    body, block, `switch`, class `static {}` block or TS `namespace` (including `export`ed
    namespace members)
  - a `var` anywhere in an enclosing function, since `var` is hoisted out of blocks
  - the name of a named function or class expression (`const B = function useQuery() {...}`)
- What upstream ignores is ignored here too:
  - namespace imports (`RQ.useQuery(...)`), CommonJS `require`, re-exports
    (`export { useQuery } from ...` creates no local binding), default imports
  - `@tanstack/query-core` and `@tanstack/angular-query-experimental`, because the names do not
    end in `-query`
  - adapters' hooks that are not in upstream's lists, such as Svelte's `createQuery` and
    Angular's `injectQuery`
  - `this.client.fetchQuery(...)` and `queryClient['fetchQuery'](...)`
  - `queryClient!.fetchQuery(...)`
  - `import type` and inline `type` specifiers
  - options objects behind a type assertion, such as `useQuery({ ... } as Options)`
  - quoted keys (`'queryKey': ...`)
  - `{ queries }` shorthand and `queries: cond ? [...] : [...]`
  - mappers called through an optional chain: `xs?.map(...)`, `data?.ids.map(...)`,
    `data?.list().map(...)`
  - `return` statements nested in `if` or loops inside a mapper

Known **false negatives**, which upstream reports and this plugin does not. Cases 1 to 4 were
checked by hand against Biome 2.5.15. The fixture `tests/fixtures/prefer-query-options` does not
cover them.

```tsx
// 1. A QueryClient reached through more than one variable hop. Upstream follows every
//    `const a = b`, and resolves `var` declarations hoisted out of a block.
const queryClient = useQueryClient()
const client = queryClient
client.fetchQuery({ queryKey: ['todos'], queryFn })  // not reported

if (ready) { var late = new QueryClient() }
late.fetchQuery({ queryKey: ['todos'], queryFn })    // not reported

// 2. A declaration of the same name as something else, further out than the client
//    declaration. Any non-client declaration of the name in an enclosing function or block
//    counts as shadowing, wherever it sits.
function Outer() {
  const qc = makeLogger()
  function Inner() {
    const qc = useQueryClient()
    qc.fetchQuery({ queryKey: ['todos'], queryFn })  // not reported
  }
}

// 3. Result branches nested more than two levels deep inside a mapper. Upstream recurses
//    without limit.
useQueries({ queries: ids.map(() => (a ? (b ? (c ? { queryKey: ['d'] } : x) : y) : z)) }) // not reported

// 4. More than two pairs of redundant parentheses around an options object. `biome format`
//    removes them anyway.
useQuery(((({ queryKey: ['todos'] }))))              // not reported

// 5. Computed keys whose expression is an identifier named `queryKey` / `queryFn`. ESLint's
//    isPropertyWithIdentifierKey() does not check `computed`, so upstream reports these.
useQuery({ [queryKey]: ['todos'] })                  // not reported

// 6. A `.map()` receiver whose optional-chain test is approximate. A `[...]` or `(...)` link is
//    recognised from its text, so a `?.[` or `?.(` anywhere inside it makes the plugin treat
//    the receiver as an optional chain and skip it.
useQueries({ queries: lookup[key?.[0]].map((id) => ({ queryKey: [id] })) }) // not reported
```

Known **false positives**, which this plugin reports and upstream does not: none known. The
scopes the plugin tracks are listed under "Shadowing" above. Any binding form that is not listed
there would be a false positive if it shadowed a TanStack import or a client variable, such as
an `enum` member or an `import x = require()` alias inside a namespace.

The QueryClient methods are matched by name on a resolved client only. A `fetchQuery` method on
any other object, such as `analytics.fetchQuery({ queryKey })`, is never reported.

### Performance

These measurements are for Biome 2.5.15 on an Apple-silicon laptop, linting generated `.tsx`
files with only this standalone plugin:

| File | Time |
| --- | --- |
| 3,600 lines of component code, about 1,100 TanStack calls, no violations | about 0.6 s |
| The same file with 60 violations | about 2.1 s |
| 900 lines with 300 inline `useQueries` entries (all reported) | about 4.1 s |

Violation-heavy files are slower because of how Biome's GritQL engine works. Every diagnostic a
plugin reports makes its later matching steps in the same file slower, so the cost grows with
the number of reports times the code that follows them. Before this rule wrapped its pure checks
in `not not` (see the notes at the top of the `.grit` file), the 60-violation file took 5.5 s.

The composed presets put every rule's definitions into one file, which makes each rule slower.
Linting the 3,600-line file above with a scratch build of `recommended-strict.grit` took about
33 s, against about 0.6 s for this rule alone. If lint time matters, list the standalone rule
files in `plugins` instead of the preset.

## Fixes

None. Upstream is not fixable either. Moving options into a `queryOptions()` factory needs a new
name, a place to declare it, and the hook's closure variables turned into parameters. That is a
refactoring, not a mechanical rewrite. `biome lint --write` and `--write --unsafe` leave code
untouched for this rule.

## Suppressing

Put the comment on the line directly before the line where the diagnostic **starts**. For
multi-line calls, that is not always the line of the call:

- For a `useQueries` entry, it is the line before the reported member (see the list above), or before the entry's `{` when the entry only has a shorthand `queryFn`.
- For a filter object written over several lines, it is the line before its `queryKey:` line.

```tsx
// Standalone plugin (rules/prefer-query-options.grit):
// biome-ignore lint/plugin/prefer-query-options: legacy screen, migrating in JIRA-123
useQuery({ queryKey: ['legacy'], queryFn: fetchLegacy })

// Composed preset (rules/recommended-strict.grit). The category is named after the preset
// file, so this also hides any other rule of the preset reporting on the same line:
// biome-ignore lint/plugin/recommended-strict: legacy screen
useQuery({ queryKey: ['legacy'], queryFn: fetchLegacy })

// Using rules/index.grit? It does not contain this rule (recommended-strict only), so
// `lint/plugin/index` never applies to it.

// Any plugin:
// biome-ignore lint/plugin: legacy screen
useQuery({ queryKey: ['legacy'], queryFn: fetchLegacy })
```

## Severity

`error`, matching upstream's `recommended-strict` config. Upstream's `recommended` config does not
enable this rule, so `index.grit` does not include it.
