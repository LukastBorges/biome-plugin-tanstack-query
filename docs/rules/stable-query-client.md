# `@tanstack/query/stable-query-client`

Makes sure that the `QueryClient` is stable.

- Upstream rule: [`@tanstack/query/stable-query-client`](https://tanstack.com/query/latest/docs/eslint/stable-query-client)
- Plugin file: [`rules/stable-query-client.grit`](../../rules/stable-query-client.grit)
- Included in presets: `index.grit` (recommended), `recommended-strict.grit`

## Rule details

The `QueryClient` holds the `QueryCache`, so an application should create one
instance for its whole lifetime, **not** a new instance on every render. A
client created in the body of a component or custom hook is thrown away (with
its whole cache) every time that component renders.

> Exception: creating a client inside an **async** function component (a React
> Server Component) is fine, because it only runs once per request.

The diagnostic is reported on the `new QueryClient(...)` expression, with the
upstream message:

```
@tanstack/query/stable-query-client: QueryClient is not stable. It should be either extracted from the component or wrapped in React.useState. See https://tkdodo.eu/blog/react-query-fa-qs#2-the-queryclient-is-not-stable
```

(Upstream puts the "See ..." link on a second line. In Biome 2.5.15 a `\n`
escape in a plugin message corrupts the rest of the string (every following
`t` becomes a tab, so `https` turns into `h\t\tps`), and a literal line break
does not compile, so this port keeps the message on one line.)

Examples of **incorrect** code for this rule:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

function App() {
  const queryClient = new QueryClient()
  //                  ^^^^^^^^^^^^^^^^^ reported here
  return (
    <QueryClientProvider client={queryClient}>
      <Home />
    </QueryClientProvider>
  )
}

export function useQueryClientSetup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return client
}
```

Examples of **correct** code for this rule:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

function App() {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <Home />
    </QueryClientProvider>
  )
}
```

```tsx
const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Home />
    </QueryClientProvider>
  )
}
```

```tsx
async function App() {
  const queryClient = new QueryClient()
  await queryClient.prefetchQuery(options)
}
```

## Coverage vs. upstream

**Status: partial** (deliberately narrower than upstream; every case this port
reports is also reported by upstream, with one technicality: upstream records
imports as it walks the file, so it misses a component that appears *above*
the `import { QueryClient }` line, while this port reports it, as imports are
hoisted).

What is detected, exactly like upstream:

- `const|let|var <binding> = new QueryClient(...)` where the `new` expression is
  the declarator's initializer (also `new QueryClient` without parentheses,
  `= (new QueryClient())`, any binding pattern, every declarator of a
  multi-declarator statement).
- Only when the file imports a **value** binding named `QueryClient` from
  exactly `@tanstack/react-query` (`import { QueryClient } ...`,
  `import Def, { QueryClient } ...`, `import { Other as QueryClient } ...`).
  `import type { QueryClient }`, default and namespace imports, other packages
  (`@tanstack/solid-query`, `@tanstack/vue-query`, `@tanstack/query-core`,
  `react-query` v3, `other-library`, deep imports such as
  `@tanstack/react-query/build/modern`), CommonJS `require` and files without
  the import are never reported, as upstream. (`import { type QueryClient }`
  is not reported either; upstream would report it, but `new` on a type-only
  import does not compile anyway.)
- Only inside a function **declaration**, **named function expression** or
  `export default function Name()`, whose name starts with an upper-case letter
  (component) or is a hook name, which is **not async** and which is **not
  nested** in another function, arrow function or method. Arrow-function
  components, anonymous functions, class and object methods are never
  considered (upstream looks at the function's `id`, which they do not have).
- Components passed to a HOC (`memo(function App() {...})`), named function
  expressions in object literals (`{ render: function Render() {...} }`) and
  components declared in a namespace or a class `static {}` block are not
  nested in a function, so they are reported, as upstream.
- Generators are not async, so `function* Gen()` is reported, as upstream.
- Blocks inside the component (`if`, loops, `try`) do not matter: the client is
  still created on every render that reaches it.

Known differences (all are **false negatives** compared with upstream, chosen
to avoid false positives):

- **Declarations inside a nested function of the component are not reported.**
  Upstream checks the *outermost* function only, so it reports every one of
  these. They do not create a client on every render, so this port stays
  silent:

  ```tsx
  function App() {
    // upstream reports both, this port reports neither
    const [client] = useState(() => {
      const c = new QueryClient()
      c.setQueryDefaults(['todos'], { staleTime: 1000 })
      return c
    })
    useEffect(() => {
      const c = new QueryClient()
      return () => c.clear()
    }, [])
  }
  ```

  The flip side is a real false negative: a helper defined and called inside
  the component on every render.

  ```tsx
  function App() {
    function makeClient() {
      const c = new QueryClient() // not reported (upstream reports it)
      return c
    }
    const client = makeClient()
  }
  ```

- **Hook names follow React's convention.** Upstream accepts any name matching
  `/^(use|[A-Z])/`, so `function user()` or `function useless()` count as hooks.
  This port requires `use` alone or `use` followed by an upper-case letter or a
  digit (`useClient`, `use2`). Component names (`/^[A-Z]/`) are unchanged.

  ```tsx
  function username() {
    const c = new QueryClient() // not reported (upstream reports it)
  }
  ```

- **A component that declares its own `QueryClient` binding is skipped.**
  Upstream has no scope check and reports `new QueryClient()` even when
  `QueryClient` is a parameter or a local variable, function or class of the
  component. This port skips the whole component as soon as a binding named
  `QueryClient` appears anywhere inside it (also in a nested function that does
  not enclose the `new` expression, which is a false negative). Destructuring
  that renames (`{ QueryClient: Other }`) binds `Other` and does not count.

  ```tsx
  import { QueryClient } from '@tanstack/react-query'

  function App({ QueryClient }: Props) {
    const client = new QueryClient() // not reported (upstream reports it)
  }
  ```

- **Only one level of parentheses** around the initializer is recognized:
  `= (new QueryClient())` is reported, `= ((new QueryClient()))` is not
  (upstream reports both). Biome's formatter removes such parentheses anyway.

Shared with upstream (no scope or type information in either):

- **Arrow-function components are not reported** (upstream's
  `isValidReactComponentOrHookName` receives `null` for them). Neither are
  components nested in a non-component function, such as test wrappers:

  ```tsx
  const App = () => {
    const queryClient = new QueryClient() // not reported (nor upstream)
  }
  function createWrapper() {
    return function Wrapper({ children }) {
      const queryClient = new QueryClient() // not reported (nor upstream)
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
  }
  ```

- **Only a direct variable initializer counts.** Clients created anywhere else
  are not reported, even when they are recreated on every render:

  ```tsx
  function App() {
    const ref = useRef(new QueryClient()) // not reported
    return <QueryClientProvider client={new QueryClient()} /> // not reported
  }
  ```

- **Aliases and namespaces are not followed.** `new RQ.QueryClient()` (namespace
  import) and `new Client()` after `import { QueryClient as Client }` are not
  reported.
- **Synchronous React Server Components are reported.** Only `async`
  components are recognized as server components. A non-async server component
  (Next.js App Router files without `'use client'`) runs once per request, so a
  client created there is fine, but neither upstream nor this port can tell it
  apart from a client component. Suppress it, or make the component `async`.
- **TS wrappers around the initializer** (`new QueryClient()!`,
  `new QueryClient() satisfies QueryClient`, `<QueryClient>new QueryClient()`)
  are not direct initializers, so they are not reported.

## Fixes

None: the rule is report-only, so neither `biome lint --write` nor
`biome lint --write --unsafe` changes anything.

Upstream autofixes the declaration to

```diff
-  const queryClient = new QueryClient(options)
+  const [queryClient] = React.useState(() => new QueryClient(options))
```

(nothing for destructuring patterns). This port does not ship that rewrite:

- it assumes `React` is in scope as a value, which is often false with the
  automatic JSX runtime, so the fixed code would throw a `ReferenceError`;
- it adds a hook call wherever the declaration is, including after an early
  `return` or inside an `if`, which breaks the rules of hooks;
- it drops a type annotation on the binding (`const c: MyClient = ...`);
- in Biome 2.5.15 every rewrite of a plugin file is merged into the fix of the
  first diagnostic of that plugin in the file. A rewrite marked
  `fix_kind="unsafe"` is therefore applied by plain `--write` when it is merged
  into a safe fix of another rule of the `index.grit` preset, and it is also
  applied to declarations that carry a `biome-ignore` comment. Both were
  reproduced with Biome 2.5.15.

Apply the upstream transformation by hand: move the client to module scope, or
use `const [queryClient] = useState(() => new QueryClient())` at the top of the
component.

## Suppressing

Put the comment on the line before the `new QueryClient(...)` expression.
When the declaration spans several lines, that is the line before `new`, not
the line before `const`:

```tsx
const queryClient =
  // biome-ignore lint/plugin/stable-query-client: rendered once, by design
  new QueryClient({ defaultOptions })
```

Standalone plugin (`rules/stable-query-client.grit` in `biome.json`):

```tsx
function App() {
  // biome-ignore lint/plugin/stable-query-client: this component is rendered once, by design
  const queryClient = new QueryClient()
}
```

Preset (`rules/index.grit` or `rules/recommended-strict.grit`): the category is
named after the plugin file, so this suppresses **every** rule of the preset on
that line:

```tsx
function App() {
  // biome-ignore lint/plugin/index: this component is rendered once, by design
  const queryClient = new QueryClient()
}
```

`// biome-ignore lint/plugin: <reason>` suppresses all plugins and works with
either setup.

## Severity

`error`, as in upstream's `recommended` and `recommended-strict` configs.

## Performance

The rule anchors on `new QueryClient` expressions, which are rare, and checks
the cheap, local parts first (direct initializer, enclosing component, no
nested function) before looking at the module's imports. The shadowing check
walks the component only when its text mentions `QueryClient` as a whole word
at least twice; most components mention it once (`new QueryClient()`) and
skip it.

Measured with Biome 2.5.15 (CPU time, whole `biome lint` run, this plugin
only):

| File | Time |
| --- | --- |
| 3,000 lines, 150 components, no violation | 0.26 s |
| 3,000 lines, 150 components, 2 violations | 0.49 s |
| 3,000 lines, 150 components, 15 violations | 1.2 s |
| 600 lines, 5 large components, each a violation with a `QueryClient` type annotation (shadowing walk runs) | 0.8 s |
| 600 lines, 150 tiny components, each a violation (contrived) | 2.5 s |

Each reported violation costs a few milliseconds plus a share that grows with
the file size, so the cost only shows in files with many violations.
