# `@tanstack/query/no-rest-destructuring`

Disallow object rest destructuring on query results.

- Upstream rule: [`@tanstack/query/no-rest-destructuring`](https://tanstack.com/query/latest/docs/eslint/no-rest-destructuring) (mirrors `@tanstack/eslint-plugin-query@5.104.1`)
- Plugin file: [`rules/no-rest-destructuring.grit`](../../rules/no-rest-destructuring.grit)
- Included in presets: `index.grit` (recommended), `recommended-strict.grit`

## Rule details

TanStack Query tracks which fields of a query result a component reads, and
re-renders only when one of those fields changes. Object rest destructuring
(`const { data, ...rest } = useQuery(...)`) and object spread (`{ ...query }`)
read every field, so the component subscribes to all of them and re-renders on
every change of the query. This rule reports those patterns so that you only
subscribe to the fields you actually need.

The rule looks at the result of these hooks when they are imported by name
from a `@tanstack/*-query` package (`@tanstack/react-query`,
`@tanstack/vue-query`, `@tanstack/solid-query`, ...):

| Hook | Returns | Reported |
| --- | --- | --- |
| `useQuery`, `useInfiniteQuery`, `useSuspenseQuery`, `useSuspenseInfiniteQuery` | one query result | `const { a, ...rest } = useQuery()`; and, when the result is stored first (`const query = useQuery()`), `{ ...query }` and `const { a, ...rest } = query` |
| `useQueries`, `useSuspenseQueries` | an array of query results | `const [first, { a, ...rest }] = useQueries(...)` |

The diagnostic is reported on the **rest element** (`...rest`) or on the
**spread** (`...query`), with the upstream message:

```
@tanstack/query/no-rest-destructuring: Object rest destructuring on a query will observe all changes to the query, leading to excessive re-renders.
```

Examples of **incorrect** code for this rule:

```tsx
import { useQueries, useQuery } from '@tanstack/react-query'

const useTodos = () => {
  const { data: todos, ...rest } = useQuery({
    //                 ^^^^^^^ reported here
    queryKey: ['todos'],
    queryFn: () => api.getTodos(),
  })
  return { todos, ...rest }
}

function Todos() {
  const todosQuery = useQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  return { ...todosQuery, data: todosQuery.data?.[0] }
  //       ^^^^^^^^^^^^^ reported here
}

function Dashboard() {
  const [users, { data, ...projects }] = useQueries({ queries: [usersQuery, projectsQuery] })
  //                    ^^^^^^^^^^^ reported here
}
```

Examples of **correct** code for this rule:

```tsx
import { useQueries, useQuery } from '@tanstack/react-query'

const todosQuery = useQuery({
  queryKey: ['todos'],
  queryFn: () => api.getTodos(),
})

// normal object destructuring is fine
const { data: todos } = todosQuery

// so is rest destructuring or spreading a FIELD of the result
const { first, ...others } = todosQuery.data
const copy = { ...todosQuery.data }

// rest elements nested in a sub-pattern spread that sub-value, not the query
const {
  data: { id, ...item },
} = useQuery(itemQuery)

// array rest on useQueries does not read any query result field
const [usersQuery, ...otherQueries] = useQueries({ queries })
```

## Coverage vs. upstream

**Status: partial.** Everything the upstream rule reports *without* typed
linting is covered, except for the scoping differences listed below. The
type-aware part of the upstream rule (custom hooks that return a query
result) needs TypeScript type information, which GritQL does not have.

Upstream test suite (5.104.1), ported to `tests/fixtures/no-rest-destructuring/`:

- Untyped valid: 20/24. All 18 "not captured / not destructured /
  destructured without rest" cases, for all six hooks, and 2 of the 6
  "not from tanstack query" cases (`useQuery` from `@acme/react-query`,
  `useSuspenseInfiniteQuery` from `@tanstack/react-query-devtools`). The other
  4 would need one fixture file to import the same hook name from two modules.
  They exercise the same import check.
- Untyped invalid: 8/8.
- Typed valid: 2/2 (neither is reported).
- Typed invalid: 0/4 as written, because all four go through a custom hook
  that needs type information. The "assigned, then destructured with rest"
  shape is covered with a direct hook call instead.

Detected, as upstream:

- Rest destructuring of a direct call to `useQuery`, `useInfiniteQuery`,
  `useSuspenseQuery`, `useSuspenseInfiniteQuery`, with `const`, `let` or
  `var`, with or without type arguments or a type annotation, also when the
  declaration has several declarators.
- Rest destructuring of a direct element of the array returned by
  `useQueries` / `useSuspenseQueries`. As upstream, elements with a default
  value (`[{ data, ...rest } = {}]`) and elements of nested array patterns are
  not inspected.
- A query result stored in a variable, then spread (`{ ...query }`) or rest
  destructured (`const { data, ...rest } = query`), also inside closures,
  blocks, loops, `switch` cases, JSX attribute values and object methods
  (Vue's `setup()`) of the function that called the hook. Spreads in arrays
  or call arguments (`[...query]`, `f(...query)`) are reported too, like
  upstream; both are type errors on a single query result anyway.
- Every `@tanstack/*-query` adapter (`react-query`, `vue-query`,
  `solid-query`, `svelte-query`, ...), like upstream, even though the
  "excessive re-renders" argument is about React's tracked query results.
  Disable or suppress the rule if it does not apply to your adapter.
- Import awareness: the hook must be a named value import from a module that
  starts with `@tanstack/` and ends with `-query`, matched on the local name
  (`import { useQuery }`, `import { type useQuery }`,
  `import Default, { useQuery }`). `import type { useQuery }` (also written
  `import type{ useQuery }`), namespace imports and other packages (including
  `@tanstack/react-query-devtools` and `@tanstack/query-core`) are ignored.

Deliberate differences (precision first):

- **Stored results are tracked per function, not per file.** Upstream
  remembers the *name* of every variable that received a query result and
  reports any later spread of that name anywhere in the file. This port only
  follows the name inside the function that called the hook (closures in that
  function included), and skips functions, blocks, loops, `switch`
  statements, `catch` clauses and class static blocks that bind the same name
  again:

  ```tsx
  function Owner() {
    const query = useQuery(todosQuery)
    return query.data
  }
  // upstream reports this (false positive), this port does not
  function Unrelated(query: { a: number }) {
    return { ...query }
  }
  ```

- **A local binding of the hook name hides the import.** Upstream compares
  names only, so it treats a local `const useQuery = () => ...`, a parameter
  named `useQuery` or a nested `function useQuery()` as TanStack's hook. This
  port does not report a call when any function enclosing it binds the hook's
  name (anywhere inside that function, so this errs towards silence).

- **`useQueries` results stored in a variable are not tracked.** Upstream
  reports `const queries = useQueries(...); [...queries]`, but spreading the
  array reads no field of the query results.

Known false negatives:

- Custom hooks that return a query result (upstream detects them with typed
  linting only):

  ```tsx
  const useTodos = () => useQuery(todosQuery)
  const { data, ...rest } = useTodos() // not reported
  ```

- A stored result that is spread in a *different* function, or whose hook call
  is not a direct statement of the function body (Rules of Hooks require hooks
  at the top level anyway):

  ```tsx
  function Todos({ enabled }: { enabled: boolean }) {
    const query = useQuery(todosQuery)
    function render() {
      return { ...query } // reported: a closure of the same component is fine
    }
    if (enabled) {
      const other = useQuery(otherQuery) // not a direct statement of the body
      return { ...other } // not reported
    }
    return render()
  }

  function Other() {
    return { ...query } // not reported: `query` is not declared in this function
  }
  ```

- A closure, block, loop or `switch` that binds the same name anywhere inside
  it (even in a nested function) is skipped entirely, even where the outer
  variable is used:

  ```tsx
  const query = useQuery(todosQuery)
  const handler = () => {
    const log = (query: unknown) => console.log(query)
    return { ...query } // not reported
  }
  ```

- Shared with upstream: aliased imports (`import { useQuery as useQ }`),
  namespace calls (`TanstackQuery.useQuery()`), wrapped calls
  (`useQuery() as X`, `useQuery()!`, `await useQuery()`), wrapped spreads
  (`{ ...query! }`), assignment destructuring
  (`({ data, ...rest } = useQuery())`), JSX spread attributes
  (`<Child {...query} />`), and rest inside a `useQueries` element that has a
  default value.

Known false positives (shared with upstream):

- A `let` variable reassigned to something else before being spread is still
  treated as the query result:

  ```tsx
  let query = useQuery(todosQuery)
  query = placeholder
  return { ...query } // reported
  ```

- Spreads of a stored result in arrays and call arguments (`[...query]`,
  `f(...query)`) are reported although they do not read query fields the
  usual way (both are type errors on a query result).

## Fixes

None, neither with `--write` nor with `--write --unsafe`. Upstream does not
provide a fix either: which fields the code really needs is a decision only a
human can make (replacing `...rest` with an explicit list of fields changes
the shape of the value).

## Suppressing

Put the comment on the line before the reported rest element or spread.

Standalone plugin (`rules/no-rest-destructuring.grit` in `biome.json`):

```tsx
// biome-ignore lint/plugin/no-rest-destructuring: notifyOnChangeProps is set manually
const { data, ...rest } = useQuery({ queryKey, queryFn, notifyOnChangeProps: ['data'] })
```

Preset (`rules/index.grit` or `rules/recommended-strict.grit` in
`biome.json`), where the plugin name is the preset file name:

```tsx
// biome-ignore lint/plugin/index: notifyOnChangeProps is set manually
const { data, ...rest } = useQuery({ queryKey, queryFn, notifyOnChangeProps: ['data'] })
```

`// biome-ignore lint/plugin: <reason>` suppresses every plugin on that line.
As upstream suggests, consider disabling the rule entirely if you set
`notifyOnChangeProps` manually, since tracked queries are not used then.

## Severity

`warn` (Biome reports it as a warning), matching the upstream `recommended`
config. Warnings do not fail `biome lint` / `biome ci` unless you pass
`--error-on-warnings`.

## Performance

The rule anchors on rest elements and spreads (common in React code) and
walks *up* the tree from them; only candidates that already look like a
finding pay for the import and shadowing checks.

Two Biome 2.5 behaviours shape the implementation (both measured with
Biome 2.5.15):

- Every successful match of a plugin whose entry point is a named pattern
  makes the evaluation of every later node in the file slower. The rule
  therefore registers its diagnostic and then fails on purpose (`false` after
  `register_diagnostic`): the diagnostic is kept, but no match is recorded. On
  a 3,000-line file with 200 findings this took lint time from 93 s to 2 s.
  The test suite would fail if a future Biome dropped diagnostics from failed
  matches.
- Every evaluation step copies the values of all variables declared anywhere
  in the plugin, so the rule keeps its variable count low and writes most of
  its logic inline.

Stress test (Apple Silicon, CPU time, standalone plugin): a generated
3,000-line file with 200 components and about 1,000 rest elements and spreads
lints in about 1.3 s with no findings and about 2.0 s with 200 findings. A
dense 300-line file takes about 0.15 s.
