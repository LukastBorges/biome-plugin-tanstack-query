# `@tanstack/query/no-void-query-fn`

Disallow returning void from query functions.

- Upstream rule: [`@tanstack/query/no-void-query-fn`](https://tanstack.com/query/latest/docs/eslint/no-void-query-fn)
- Plugin file: [`rules/no-void-query-fn.grit`](../../rules/no-void-query-fn.grit)
- Included in presets: `index.grit` (recommended), `recommended-strict.grit`

## Rule details

A query function must return the data that TanStack Query caches. If it
resolves to `undefined`, the query fails at runtime ("Query data cannot be
undefined"). A query function that returns nothing is usually a forgotten
`return`.

Upstream asks the TypeScript type checker for the return type of every
`queryFn` and reports it when the awaited type is `void` or `undefined`, or a
union that contains one of them. GritQL has no type information, so this port
works out the same answer from the code's structure (see
[Coverage vs. upstream](#coverage-vs-upstream)).

The diagnostic is reported on the `queryFn` **value**: the function, or the
identifier that names it. For method shorthand (`queryFn() {...}`) it is
reported on the method body. The message is the upstream one:

```
@tanstack/query/no-void-query-fn: queryFn must return a non-undefined value
```

Examples of **incorrect** code for this rule:

```tsx
import { queryOptions, useQuery } from '@tanstack/react-query'

useQuery({
  queryKey: ['todos'],
  queryFn: async () => {
    await api.todos.fetch() // the fetched data is never returned
  },
})

useQuery({
  queryKey: ['todo', id],
  queryFn: async () => {
    const response = await fetch(`/api/todos/${id}`)
    if (!response.ok) return // resolves to undefined
    return response.json()
  },
})

useQuery({
  queryKey: ['todos'],
  queryFn: () =>
    fetch('/api/todos').then((response) => {
      response.json() // missing `return`: the promise resolves to undefined
    }),
})

async function refreshTodos(): Promise<void> {
  await fetch('/api/todos/refresh', { method: 'POST' })
}

export const todosOptions = queryOptions({
  queryKey: ['todos'],
  queryFn: refreshTodos,
})
```

Examples of **correct** code for this rule:

```tsx
import { useQuery } from '@tanstack/react-query'

useQuery({
  queryKey: ['todos'],
  queryFn: async () => {
    const todos = await api.todos.fetch()
    return todos
  },
})

useQuery({
  queryKey: ['todo', id],
  queryFn: async () => {
    const response = await fetch(`/api/todos/${id}`)
    if (!response.ok) {
      throw new Error('Request failed')
    }
    return response.json()
  },
})

// null is a valid value
useQuery({ queryKey: ['settings'], queryFn: () => null })
```

## Coverage vs. upstream

**Status: partial** (structural approximation of a type-aware rule; biased
towards silence whenever the structure does not settle the return type).

All 21 valid and 17 invalid cases of the upstream test suite are ported to
`tests/fixtures/no-void-query-fn/` and behave as upstream. The fixtures also
hold near-misses and regression cases (overloads, annotated variables,
`declare`d functions, shadowing in namespaces / static blocks / setters /
`var`, hoisted helpers after the final `return`, labeled loops,
`do...while`, ...).

### What is detected

A `queryFn` key that is an identifier (`queryFn: ...`, `queryFn() {}`,
`{ queryFn }`), in any object literal (`useQuery`, `useSuspenseQuery`,
`useInfiniteQuery`, `useQueries`, `queryOptions`, `queryClient.fetchQuery`,
`prefetchQuery`, `ensureQueryData`, ..., in every framework adapter), whose
value is:

- **An arrow function, `function` expression or method with a return type
  annotation** that is `void`, `undefined`, `Promise<void>`,
  `PromiseLike<undefined>`, a union containing one of them
  (`Promise<Todo | undefined>`, `Todo | undefined`), or a parenthesized form of
  these. When an annotation is present it decides on its own, like the type
  checker: `async (): Promise<Todo[]> => {...}` is never reported, whatever its
  body does.
- **A concise arrow body** that evaluates to `undefined`: `undefined`,
  `void expr`, `Promise.resolve()`, `Promise.resolve(undefined)`,
  `new Promise<void>(...)`, any `console.*(...)` call, `await` of one of these,
  a conditional with an `undefined` branch (`cond ? data : undefined`), or
  `x.then(callback)` where the callback itself is void.
- **A block body** (arrow, `function` expression, method) where:
  - some own `return` (not one of a nested function) has no argument, or an
    argument from the list above (`return undefined`, `return;`);
  - nothing is returned and the end of the body is reachable, e.g.
    `async () => { await save() }`, `() => {}`;
  - values are returned but the end of the body is also reachable: an `if`
    without `else`, a `catch` block that only logs, a `switch` without
    `default`, a `for...of` / `while` / labeled loop or a `do...while` that
    returns from inside, ...

  The end of a body is reachable when **every** statement in it can complete
  normally, so a helper `function` declared after the final `return` (hoisting
  style) does not count as reaching the end.
- **An identifier** naming a value declared at the **top level of the same
  file** (also `export`ed), resolved to its **first** declaration, which is
  the one the type checker uses:
  - `function name() {...}` matching the rules above. For a function
    *declaration*, returning nothing is enough: TypeScript types it `void`
    even when it always throws.
  - an overload signature or an ambient `declare function name(): T` /
    `export declare function`, judged by its return type annotation only. For
    an overloaded function this is the first signature, as upstream.
  - `const name = <arrow | function>` (one declarator) matching the rules
    above, or `const name: <type> = ...` / `declare const name: <type>` whose
    type is a void function type (`() => Promise<void>`,
    `QueryFunction<void>`). Any other variable annotation
    (`const load: QueryFunction<Todo[]> = ...`) decides on its own and is
    never reported, whatever the function's body is, like upstream.
- `{ queryFn }` shorthand naming such a top-level value.

Generators (`function* () {}`, `*queryFn() {}`) are never reported.

### Import awareness

A `queryFn` is linted when either:

- the object literal that directly contains it also has a `queryKey` member
  (`{ queryKey, queryFn }` is TanStack Query's signature; this also covers
  files that import the hooks through a project wrapper such as
  `@/lib/query`), or
- the file imports something (including `import type` and side-effect
  imports) from a module matching `@tanstack/<...>query<...>`:
  `@tanstack/react-query`, `@tanstack/vue-query`, `@tanstack/solid-query`,
  `@tanstack/svelte-query`, `@tanstack/angular-query-experimental`,
  `@tanstack/query-core`, ...

Upstream's import tracking is not actually used by this rule: it reports every
`queryFn` property of every file, but only when type information is
configured (`parserOptions.project`); without it, it reports nothing. This
port needs no type information and requires one of the two signals above, so
that `queryFn` keys of unrelated libraries (for example RTK Query's
`createApi` endpoints, which have no `queryKey`) are left alone in files that
do not import TanStack Query.

### Known false negatives (reported by upstream, not by this port)

Anything that needs type information or cross-file knowledge:

```tsx
// The return type of a call is unknown without types.
queryFn: () => saveTodos(), // saveTodos(): Promise<void>
queryFn: () => queryClient.invalidateQueries(), // Promise<void>
queryFn: async () => { return logVisit() },
queryFn: () => fetchTodos().then(normalize), // normalize is void
queryFn: () => fetchTodos().then((t) => t, () => { report() }), // Promise<T | void>

// Imported functions: their body is in another file.
import { refreshTodos } from './api'
queryFn: refreshTodos,

// Values that are not top-level `function` / `const` / `declare` declarations.
queryFn: api.todos.refresh,
queryFn: useCallback(async () => { await save() }, []),
let refresh = async () => { await save() }
queryFn: refresh, // `let` / `var` can be reassigned
const refresh = async () => { await save() }, other = 1 // several declarators
export default function refresh() {}
function Component() {
  const refresh = async () => { await save() } // declared inside a component
  useQuery({ queryKey, queryFn: refresh })
}

// Type assertions and conditional values.
queryFn: (async () => { await save() }) as QueryFunction<void>,
queryFn: enabled ? async () => { await save() } : skipToken,

// A computed key (upstream checks `[queryFn]: ...`, this port does not).
```

Bodies where reachability is uncertain without types:

```tsx
// Values are returned on some path and the body ends with a call to a
// function that might be typed `never`, so the rule stays silent.
queryFn: async () => {
  try {
    return await fetchTodos()
  } catch (error) {
    reportError(error) // void? never? unknown without types
  }
},

// Constructs treated conservatively as "may not complete": labeled blocks,
// `while (true)` / `for (;;)` / `do...while (true)` left with a `break`, a
// `switch` whose last clause ends with `break` inside a nested block, ...

// `.catch(() => {})`, `a ?? undefined`, `a || undefined`, `(a, undefined)` and
// other expressions whose type may or may not include undefined.
queryFn: () => fetchTodos().catch((error) => console.error(error)),
```

Files without a TanStack Query import are only linted where the `queryFn`
sits next to a `queryKey` (so `{ ...baseOptions, queryFn }` in such a file,
or CommonJS `require('@tanstack/react-query')` users, are not covered).

### Known false positives (not reported by upstream)

The rule reports only code whose return type, as written, includes `void` or
`undefined`. It can still disagree with the type checker:

```tsx
// `any` absorbs `undefined` in a union, so upstream sees `Promise<any>` here
// (`response.json()` is `any`) and stays silent. This port reports it; it is
// a real bug (the query fails with "Query data cannot be undefined").
queryFn: async () => {
  const response = await fetch('/api/todos')
  if (!response.ok) return
  return response.json()
},

// Without `strictNullChecks`, TypeScript drops `undefined` from unions, so
// upstream does not report a bare `return` mixed with value returns. This
// port always does.

// A body that returns nothing and ends with a call to a custom function typed
// `never` is typed `never` by TypeScript, not `void`. Only a few well-known
// ones are recognized (`process.exit`, Next.js `notFound`, `redirect`,
// `permanentRedirect`, `forbidden`, `unauthorized`):
declare function fail(message: string): never
queryFn: () => {
  fail('disabled') // reported here, not by upstream
},

// Shadowed globals (`undefined`, `console`, `Promise`) are not detected, and
// a function parameter named after a top-level function only shadows it when
// it is a plain/destructured binding of an enclosing function, setter, catch
// clause or loop head (e.g. a named function expression's own name is not).

// In a file that does not import TanStack Query, any `{ queryKey, queryFn }`
// object is assumed to be TanStack Query (v4+, where undefined data is an
// error). The legacy `react-query` v3 package allowed undefined data.
```

## Fixes

None: the rule is report-only, so neither `biome lint --write` nor
`biome lint --write --unsafe` changes anything. Upstream has no fix either:
the missing value can only be written by a human (return the awaited data,
throw, or return `null` on purpose).

## Suppressing

Put the comment on the line before the line where the reported value starts
(for `queryFn: () => {`, the line before `queryFn`).

Standalone plugin (`rules/no-void-query-fn.grit` in `biome.json`):

```tsx
useQuery({
  queryKey: ['ping'],
  // biome-ignore lint/plugin/no-void-query-fn: the cache entry is only used as a trigger
  queryFn: async () => {
    await fetch('/api/ping')
  },
})
```

Preset (`rules/index.grit` or `rules/recommended-strict.grit`): the category is
named after the plugin file, so this suppresses **every** rule of the preset on
that line:

```tsx
useQuery({
  queryKey: ['ping'],
  // biome-ignore lint/plugin/index: the cache entry is only used as a trigger
  queryFn: async () => {
    await fetch('/api/ping')
  },
})
```

`// biome-ignore lint/plugin: <reason>` suppresses all plugins and works with
either setup.

## Severity

`error`, as in upstream's `recommended` and `recommended-strict` configs.

## Performance

The rule anchors on `queryFn` keys and analyzes each value locally; the "is
this TanStack Query?" check only runs once a violation is found. An
identifier value is resolved by walking the module's top-level statements
(not the whole file), and the shadowing check only looks at the binding
positions of the enclosing scopes.

Measured with Biome 2.5.15 (wall-clock `biome lint` time, this plugin only,
Apple Silicon):

| File | Time |
| --- | --- |
| 990 lines, 30 components, 90 `queryFn`s (30 identifiers), no violation | 0.16 s |
| 990 lines, same with 6 violations | 0.27 s |
| 1,980 lines, 60 components, no violation | 0.32 s |
| 3,630 lines, 110 components, 330 `queryFn`s, no violation | 0.65 s |
| 1,650 lines, 150 fetchers + 450 `queryOptions` (150 identifiers) | 0.65 s |
| 520 lines, 40 components, 80 violations | 0.16 s |
| 3,630 lines, 110 components, 55 violations (contrived) | 3.7 s |
| 2,000 lines, 1,500 top-level `const`s + 500 identifier `queryFn`s (pathological) | 16 s |

Two costs grow with the file:

- Each identifier `queryFn` costs time proportional to the number of
  top-level statements before its declaration (about 30-40 µs per statement), so
  a file with thousands of top-level declarations *and* hundreds of
  identifier `queryFn`s is slow.
- Each reported diagnostic costs time that grows with the size of the file
  in Biome 2.5.15's GritQL engine (about 1 ms on a 500-line file, about
  50 ms on a 3,600-line file; every plugin rule that reports from inside a
  named pattern pays it), so only files with dozens of violations and
  thousands of lines are noticeably slower.

Inside the composed presets every rule runs in one GritQL program, whose
per-node overhead grows with the size of the whole program: on the 990-line
file above, adding this rule to the other seven costs about 0.45 s on top of
their 2.5 s, against 0.16 s for this rule alone. Use the standalone plugin
files if lint time matters more than having a single plugin entry.
