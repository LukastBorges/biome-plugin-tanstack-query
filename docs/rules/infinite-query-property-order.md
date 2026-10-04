# `@tanstack/query/infinite-query-property-order`

Ensure correct order of inference-sensitive properties for infinite queries.

- Upstream rule: [`@tanstack/query/infinite-query-property-order`](https://tanstack.com/query/latest/docs/eslint/infinite-query-property-order)
- Plugin file: [`rules/infinite-query-property-order.grit`](../../rules/infinite-query-property-order.grit)
- Included in presets: `index.grit` (recommended), `recommended-strict.grit`

## Rule details

For the following functions, the order of the properties in the options object
matters, because TypeScript infers the page type from the object literal in
source order:

- `useInfiniteQuery`
- `useSuspenseInfiniteQuery`
- `infiniteQueryOptions`

The required order is:

1. `queryFn`
2. `getPreviousPageParam` and `getNextPageParam`, in either order

All other properties (`queryKey`, `initialPageParam`, `maxPages`, spreads, ...)
are order-independent and may appear anywhere.

The diagnostic is reported on the **first property that is out of order**: the
first `getPreviousPageParam` / `getNextPageParam` that has a `queryFn` after it.
The message is the upstream one, with the name of the called function:

```
@tanstack/query/infinite-query-property-order: Invalid order of properties for `useInfiniteQuery`.
```

Examples of **incorrect** code for this rule:

```tsx
import { useInfiniteQuery } from '@tanstack/react-query'

const query = useInfiniteQuery({
  queryKey: ['projects'],
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
  // ^^^^^^^^^^^^^^ reported here
  queryFn: async ({ pageParam }) => {
    const response = await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  initialPageParam: 0,
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
  maxPages: 3,
})
```

```tsx
import { infiniteQueryOptions, useSuspenseInfiniteQuery as useProjects } from '@tanstack/react-query'

infiniteQueryOptions({ queryKey, getPreviousPageParam, getNextPageParam, queryFn })
useProjects({ queryKey, getNextPageParam, initialPageParam: 0, queryFn() { return fetchPage() } })
```

Examples of **correct** code for this rule:

```tsx
import { useInfiniteQuery } from '@tanstack/react-query'

const query = useInfiniteQuery({
  queryKey: ['projects'],
  queryFn: async ({ pageParam }) => {
    const response = await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  initialPageParam: 0,
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
  maxPages: 3,
})
```

```tsx
// getNextPageParam / getPreviousPageParam may appear in any relative order
useInfiniteQuery({ queryFn, getNextPageParam, queryKey, getPreviousPageParam })
```

The full set of cases checked by the test suite is in
[`tests/fixtures/infinite-query-property-order/`](../../tests/fixtures/infinite-query-property-order/).

## Coverage vs. upstream

**Status: partial.** The ordering logic is a complete port (same functions,
same properties, same sort groups, same shorthand/method handling); the
differences come from scoping the rule to TanStack imports and from what
GritQL can see.

Detected, like upstream:

- Every permutation in which a page-param callback precedes `queryFn`,
  including when other properties or spreads are interleaved. The complete
  generated upstream test matrix was replayed against the rule: all 1,152
  invalid cases are reported exactly once, and none of the 1,512 correct-order
  variants (including the upstream "call expression spread" regression case) is
  reported. The committed fixtures keep a representative subset. For the 744
  invalid cases with no spread between the swapped properties, `--write`
  produces upstream's output; the other 408 are report-only (see Fixes).
- Shorthand (`{ getNextPageParam, queryFn }`), methods (`queryFn() {}`) and
  accessors count as properties. String-literal keys (`'queryFn': fn`) are
  ignored, as upstream does.
- Only the **first** argument, only when it is an **object literal**, only when
  the callee is a **plain identifier**. `ReactQuery.useInfiniteQuery({...})`,
  `useInfiniteQuery(options)` and `useInfiniteQuery(() => ({...}))` are not
  checked, by either implementation.
- Every TanStack Query adapter that exports these names: any `@tanstack/*-query`
  package (`@tanstack/react-query`, `@tanstack/vue-query`,
  `@tanstack/solid-query`, ...) plus `@tanstack/angular-query-experimental`,
  whose `infiniteQueryOptions` upstream also checks (it matches by name).
  Entry points that take a function instead of an object
  (`injectInfiniteQuery(() => ({...}))`, Solid's `useInfiniteQuery(() => ({...}))`,
  Svelte's `createInfiniteQuery`) are not checked, by either implementation;
  an `infiniteQueryOptions({...})` call inside them is.
- Optional calls (`useInfiniteQuery?.({...})`) are checked, as upstream.

Intentional differences:

- **Import-aware (fewer false positives, some false negatives).** Upstream
  checks any call whose callee is *named* `useInfiniteQuery` etc., wherever it
  comes from. This port only checks calls whose callee is bound by a value
  import from a module matching `@tanstack/*-query` (the same test upstream's
  `detectTanstackQueryImports` helper uses) or `@tanstack/angular-query-experimental`.
  The imported name must be exactly `useInfiniteQuery`, `useSuspenseInfiniteQuery`
  or `infiniteQueryOptions`, and the callee must be exactly its local name;
  `import type { ... }` and `import { type ... }` are ignored. Known false
  negatives compared to upstream:

  ```tsx
  // re-exported through your own module
  import { useInfiniteQuery } from '~/lib/query'
  useInfiniteQuery({ getNextPageParam, queryFn }) // upstream: reported, here: not reported

  // CommonJS / globals
  const { useInfiniteQuery } = require('@tanstack/react-query')
  useInfiniteQuery({ getNextPageParam, queryFn }) // upstream: reported, here: not reported
  ```

- **Aliased imports are checked** (upstream misses them because it compares
  the callee name):

  ```tsx
  import { useInfiniteQuery as useProjects } from '@tanstack/react-query'
  useProjects({ getNextPageParam, queryFn }) // upstream: not reported, here: reported
  ```

- **Span.** Upstream reports the whole options object; this port reports the
  first out-of-order property, so that it does not collide with other rules of
  the presets that report on the call or the options object.

Known gaps (GritQL has no scope analysis):

- Shadowing is not tracked. If the target function is imported from TanStack
  and a nested scope declares a same-named binding, calls to the inner binding
  are still checked (upstream behaves the same, since it does not track scope
  either):

  ```tsx
  import { useInfiniteQuery } from '@tanstack/react-query'
  function wrapper(useInfiniteQuery: (o: object) => void) {
    useInfiniteQuery({ getNextPageParam, queryFn }) // reported (false positive)
  }
  ```

- A parenthesized callee, `(useInfiniteQuery)({...})`, is not checked (ESTree
  drops the parentheses, so upstream reports it). This only appears in
  generated code.
- Computed keys are ignored. Upstream treats `{ [getNextPageParam]: x, queryFn }`
  as a `getNextPageParam` property (its key is an `Identifier`); this port does
  not report it. Such code is almost certainly a bug of a different kind.

## Fixes

Upstream's autofix reorders the checked properties with a stable sort. This
port offers a **safe fix** (applied by `biome lint --write`) that **swaps** the
reported property with the first `queryFn` after it:

```diff
 useInfiniteQuery({
   queryKey: ['projects'],
-  getNextPageParam: (lastPage) => lastPage.nextId,
+  queryFn: ({ pageParam }) => fetchProjects(pageParam),
   initialPageParam: 0,
-  queryFn: ({ pageParam }) => fetchProjects(pageParam),
+  getNextPageParam: (lastPage) => lastPage.nextId,
 })
```

- Only the two property nodes trade places. Commas, every other property and
  the comments **between** properties stay where they are (same as upstream),
  so a comment placed above `getNextPageParam` ends up above `queryFn`.
- When both page params come before `queryFn`, their relative order may change
  (`[getPreviousPageParam, getNextPageParam, queryFn]` becomes
  `[queryFn, getNextPageParam, getPreviousPageParam]`; upstream keeps
  `getPreviousPageParam` first). Both orders are correct.
- Biome re-runs fixes until the file is stable, so unusual objects (e.g. a
  duplicated `queryFn`) converge in several passes.

The fix is **only offered when it provably cannot change behaviour**;
otherwise the diagnostic is report-only (upstream fixes these cases too):

- a spread lies between the two properties (`...options` might contain its own
  `queryFn`, and moving a property across it changes which value wins);
- a duplicate of the moved page-param key lies between them;
- either moved value might have side effects when evaluated, i.e. it is not a
  function, arrow function, identifier, static member access (`api.fetchPage`),
  shorthand, method or accessor (`queryFn: makeFetcher('/x')`,
  `getNextPageParam: fn as Getter`).

`--write --unsafe` applies nothing more for this rule.

Biome 2.5.15 caveat: all rewrites produced by one plugin file are merged into
the fix of the **first** diagnostic of that plugin in the file. In practice:

- if the first diagnostic of the file is suppressed with `biome-ignore`, no
  fix of that plugin is applied in that file; if a later one is suppressed, its
  rewrite may still be applied together with the others;
- when using the presets (`index.grit`), rewrites of all rules in the preset are
  merged the same way, with the fix kind of the first diagnostic in the file.

## Suppressing

Put the comment on the line before the reported property.

Standalone plugin (`rules/infinite-query-property-order.grit` in `biome.json`):

```tsx
useInfiniteQuery({
  // biome-ignore lint/plugin/infinite-query-property-order: generated code
  getNextPageParam,
  queryFn,
})
```

Preset (`rules/index.grit` or `rules/recommended-strict.grit`): the category is
named after the plugin file, so this suppresses **every** rule of the preset on
that line:

```tsx
useInfiniteQuery({
  // biome-ignore lint/plugin/index: generated code
  getNextPageParam,
  queryFn,
})
```

`// biome-ignore lint/plugin: <reason>` suppresses all plugins and works with
either setup.

## Severity

`error`, as in upstream's `recommended` and `recommended-strict` configs.

## Performance

The rule anchors on call expressions whose first argument is an object literal
and checks the cheap, local property order before looking at the module's
imports, so code without violations costs almost nothing: about 0.25 s of CPU
for a 3,000-line file with 230 correctly ordered infinite queries (Biome
2.5.15, plugin only).

Each violation is more expensive. Biome 2.5.15 evaluates a named entry-point
pattern (which the presets require) so that every successful match slows down
the traversal of the rest of the file. Measured on the same 3,000-line file,
with the violations near the top (the worst case):

| Violations in the file | CPU time |
| ---------------------- | -------- |
| 0                      | 0.25 s   |
| 1                      | 0.34 s   |
| 5                      | 0.60 s   |
| 10                     | 0.91 s   |
| 50                     | 3.4 s    |

The rule binds as few variables as possible, since each one adds to that cost.
That halved the per-violation cost compared to the first implementation.
Files with dozens of violations of this rule are rare, and the cost disappears
once they are fixed (`biome lint --write` fixes most of them).
