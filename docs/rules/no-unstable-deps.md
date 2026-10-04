# `@tanstack/query/no-unstable-deps`

Upstream documentation: <https://tanstack.com/query/latest/docs/eslint/no-unstable-deps>
(mirrors `@tanstack/eslint-plugin-query@5.104.1`, `src/rules/no-unstable-deps/no-unstable-deps.rule.ts`).

Plugin file: `rules/no-unstable-deps.grit` (standalone) — also part of the `index.grit` and
`recommended-strict.grit` presets.

## Rule details

The object returned by these hooks is **not** referentially stable, so it changes on every render:

- `useQuery`, `useSuspenseQuery`
- `useQueries`, `useSuspenseQueries` (unless they have a `combine` option)
- `useInfiniteQuery`, `useSuspenseInfiniteQuery`
- `useMutation`

Listing it directly in the dependency array of `useEffect`, `useMemo` or `useCallback` re-runs the
effect or recomputes the value on every render. Destructure the result and list the destructured
values instead.

Examples of **incorrect** code:

```tsx
import { useCallback, useEffect } from 'react'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'

function Component() {
  const mutation = useMutation({ mutationFn: (value: string) => value })
  const callback = useCallback(() => {
    mutation.mutate('hello')
  }, [mutation])
  //  ^^^^^^^^ The result of useMutation is not referentially stable, ...

  const query = useQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  useEffect(() => {
    console.log(query.data)
  }, [query])
  //  ^^^^^

  const [userQuery, ...otherQueries] = useQueries({ queries })
  useEffect(() => {}, [userQuery, otherQueries])
  //                   ^^^^^^^^^  ^^^^^^^^^^^^
}

// Local wrappers that just return a query hook are followed, like upstream.
const useTodos = () => useQuery({ queryKey: ['todos'], queryFn: fetchTodos })

function Todos() {
  const todos = useTodos()
  useEffect(() => {}, [todos])
  //                   ^^^^^ The result of useQuery is not referentially stable, ...
}
```

Examples of **correct** code:

```tsx
import { useCallback, useEffect, useMemo } from 'react'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'

function Component() {
  const { mutate } = useMutation({ mutationFn: (value: string) => value })
  const callback = useCallback(() => {
    mutate('hello')
  }, [mutate])

  const query = useQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  useEffect(() => {
    console.log(query.data)
  }, [query.data])

  // `combine` makes the result whatever `combine` returns.
  const combined = useQueries({ queries, combine: (results) => results.map((r) => r.data) })
  const total = useMemo(() => combined.length, [combined])
}
```

The diagnostic is reported on the identifier **inside the dependency array**, and every offending
identifier of an array gets its own diagnostic.

## Coverage vs. upstream

**Status: partial.** Every upstream test case is detected, and so is everything upstream detects in
idiomatic React code. The port resolves names lexically instead of by bare name, which removes
upstream's cross-component false positives (details below).

Verified against the full upstream test suite (`no-unstable-deps.test.ts`): all 15 valid and 15
invalid base cases, each in all 9 React-hook forms (`useEffect` / `useMemo` / `useCallback` ×
`React.x` / named import / alias), 270 files in total. The diagnostic count and the
interpolated message match on every one.

Detected, like upstream:

- The seven hooks above, called directly by name and imported (by name, value import) from any
  `@tanstack/<framework>-query` package (`react-query`, `preact-query`, `vue-query`,
  `solid-query`, ...). Calls of a same-named function imported from anywhere else (or not imported
  at all, or imported with `import type { ... }`) are ignored. `@tanstack/query-core` and
  `@tanstack/angular-query-experimental` do not end in `-query`, so they are ignored too, as
  upstream.
- `useQueries` / `useSuspenseQueries` are exempt when their first argument is an object literal
  with a `combine` member (`combine: fn`, shorthand `combine`, or method `combine() {}`).
- Variables bound as `const x = hook()` (also `let` / `var`, any declarator of a multi-declarator
  statement, with type annotations or type arguments), and identifiers / rest identifiers of an
  array pattern: `const [a, , b, ...rest] = useQueries(...)`. Defaults and nested patterns
  (`[a = x]`, `[[a]]`, `[{ data }]`) are not tracked, as upstream.
- Custom hooks named `use[A-Z0-9]...` whose body is, or `return`s at the top level, a direct call
  of one of the hooks above: `function useX() { return useQuery(...) }`,
  `const useX = () => useMutation(...)`, `const useX = function () { ... }`,
  `export function`, `export const`, `export default function`, declared before or after use,
  at the top level or inside another function. The message names the underlying hook
  (`useQuery`), as upstream.
- React hooks: bare `useEffect` / `useMemo` / `useCallback` (not import-checked, as upstream),
  `React.useEffect(...)` and friends on an identifier literally named `React`, and aliases
  imported from react: `import { useMemo as useStableMemo } from 'react'`.
- Only the second argument, when it is an array literal; only elements that are bare identifiers
  (`[query.data]`, `[query!]`, `[fn(query)]`, `[...queries]` are not reported, as upstream).
- Dependency arrays anywhere inside the declaring function: in nested functions, in callbacks, in
  class methods.

### Name resolution (differs from upstream, in the precise direction)

Upstream records variable **names** file-wide. A `query` declared from `useQuery` in one component
therefore taints any `query` in any other component's dependency array, even when it is a
parameter or a local constant there. This port resolves each dependency to the **nearest**
enclosing function body, block, parameter list, `catch` or `for` binding that declares that name,
much as JavaScript scoping does. It reports only when that declaration is the query result. All
of these are **not** reported here (upstream reports them):

```tsx
function A() {
  const query = useQuery(options)
}
function B() {
  const query = { data: 1 }
  return useMemo(() => query.data, [query]) // a different `query`
}
function C({ ids }) {
  const query = useQuery(options)
  ids.map((query) => useMemo(() => query, [query])) // parameter shadows it
  {
    const query = 1
    useEffect(() => {}, [query]) // block constant shadows it
  }
}
```

The same resolution applies to callees. A local function, parameter or prop named `useQuery`
or named like a wrapper hook (`useTodos`) shadows the import or the top-level wrapper.

### Known false negatives

- **Parenthesised expressions**: `const q = (useQuery(o))` and `[(q)]` are not tracked
  (ESLint's AST drops parentheses, so upstream reports them). Formatters remove these parentheses.
- **Declarations upstream follows by name only**: a `useQuery` declared at module top level (an
  invalid hook call anyway), or inside a block and referenced after it (out of scope in JS).
- **React aliases that do not start with `use`**: `import { useMemo as memo } from 'react'` is not
  recognised (upstream recognises any alias from the exact specifier `"React"`).
- **Wrapper hooks named like React built-ins** (`useState`, `useRef`, `useContext`, ...) are never
  followed.
- **Wrappers written unusually**: before resolving a wrapper, the rule checks that the file text
  contains `function useX`, `const useX`, `let useX`, `var useX` or `useX =`. Formatted code
  always does; something like `function  useX` (two spaces) does not.
- `var` declared in a nested block is treated as block-scoped (JS hoists it to the function).
- Not followed by either implementation: query results reached through parameters, props,
  context, re-assignment, `as` casts or `!` in the initializer, wrappers imported from another
  file, wrappers that return another wrapper.

### Known false positives

- Inherited from upstream: bare `useEffect` / `useMemo` / `useCallback` are not checked for where
  they come from, so a same-named hook from another library is treated as React's (this is what
  makes Preact work). `React.useX` matches any identifier literally named `React`.
- Inherited from upstream: `useQueries(opts)` with a non-literal options object is reported even
  if `opts` contains `combine`.
- Upstream requires a wrapper to contain exactly one top-level `return`. This port only requires
  one top-level `return` of the hook call. Code after a top-level `return` is unreachable, so the
  two differ only on dead code.
- Shadowing declarations that the port does not model are not seen. Examples: the name of a named
  function expression inside itself, `switch`-case declarations, bindings inside parameter default
  values. Such code also breaks the rules of hooks or is contrived.

### Other differences

- **React aliases**: upstream recognises `import { useMemo as useX }` only from the exact
  specifier `"React"` (capitalised); this port accepts `"react"` and `"React"`. Aliases imported
  from anywhere else (e.g. `preact/hooks`) are ignored by both.
- `import { type useQuery } from '@tanstack/react-query'` (inline type modifier) still counts as
  an import, as upstream; `import type { useQuery }` does not.

## Fixes

None. Upstream is not fixable either: the right destructuring depends on which properties the
effect or memo actually reads, which is a judgement call. `biome lint --write` and
`--write --unsafe` leave the code untouched.

## Suppressing

With the standalone plugin (`"plugins": ["./node_modules/biome-plugin-tanstack-query/rules/no-unstable-deps.grit"]`):

```tsx
// biome-ignore lint/plugin/no-unstable-deps: the mutation object is only used for its identity here
useEffect(() => {}, [mutation])
```

With a preset (`rules/index.grit` or `rules/recommended-strict.grit`), the suppression category is
the preset file name, and it suppresses every rule of the preset on that line:

```tsx
// biome-ignore lint/plugin/index: the mutation object is only used for its identity here
useEffect(() => {}, [mutation])
```

`// biome-ignore lint/plugin: <reason>` suppresses all plugins on the next line. For a multi-line
dependency array, place the comment on the line before the line holding the offending identifier.

## Severity

`error`, matching upstream `recommended` and `recommended-strict`.

## Performance notes

Measured with Biome 2.5.15, standalone plugin, user CPU time, on generated files of typical
components (a `useQuery`, a wrapper hook, `useState` / `useRef` / `useSelector` /
`useQueryClient`, and a `useEffect`, a `useMemo` and a `useCallback` with dependency arrays in
each):

| File | Lines | Time |
| --- | --- | --- |
| clean | 1,000 | ~0.3 s |
| clean | 2,000 | ~0.6 s |
| clean | 2,800 | ~0.9 s |
| 15 violations | 2,800 | ~1.2 s |
| 30 violations | 2,800 | ~1.7 s |
| one 900-line component: 600 hooks, 300 effects, 900 dependencies | 900 | ~4.6 s |

The rule starts from each dependency array, then looks the identifiers up among the statements
of the enclosing functions. It walks scopes and imports only for the rare candidates. Two quirks
of the GritQL engine in Biome 2.5 shape the implementation (see the comments in the rule file):

- Every variable bound during a successful match is kept for the rest of the file and copied
  whenever the engine clones its state. A rule that binds many variables per match gets slower
  with every violation found. The first version of this rule took ~25 s on the 2,800-line file
  with 30 violations, and ~120 s on the 900-line component. The whole check now runs inside
  `not not { ... }`, which discards the bindings but keeps the diagnostics.
- Each `some` element and `within` ancestor clones the engine state. For every dependency, the
  statements of the enclosing bodies are therefore first filtered with a plain substring test on
  the dependency's name. Wrapper hooks are resolved only when the file text can define them.

The cost grows with (dependencies × statements in the enclosing function), so very large single
components are the slowest case.
