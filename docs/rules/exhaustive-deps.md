# `@tanstack/query/exhaustive-deps`

Upstream documentation: <https://tanstack.com/query/latest/docs/eslint/exhaustive-deps>
(mirrors `@tanstack/eslint-plugin-query@5.104.1`, `src/rules/exhaustive-deps/exhaustive-deps.rule.ts`).

Plugin file: `rules/exhaustive-deps.grit` (standalone). It is also part of the `index.grit` and
`recommended-strict.grit` presets.

## Rule details

Query keys should contain the serializable values that identify the data your `queryFn` returns.
That way queries are cached separately, and they refetch automatically when those values change.
This rule reports a `queryKey` that leaves out a variable its inline `queryFn` reads.

Function call targets are not dependencies. `fetchTodoById(todoId)` needs `todoId` in the key, but
not `fetchTodoById`. The same goes for `todos.getTodo(todoId)`, which needs `todoId` but not
`todos`. Values read inside nested callbacks are still dependencies, so
`promise.then(() => todoId)` needs `todoId` in the key.

Examples of **incorrect** code:

```tsx
import { queryOptions, useQuery } from '@tanstack/react-query'

function Todo({ todoId }) {
  useQuery({
    queryKey: ['todo'],
    //        ^^^^^^^^ The following dependencies are missing in your queryKey: todoId
    queryFn: () => api.getTodo(todoId),
  })
}

const todoQueries = {
  detail: (id) => queryOptions({ queryKey: ['todo'], queryFn: () => api.getTodo(id) }),
  //                                       ^^^^^^^^ ...missing in your queryKey: id
}

function useTodos(filters) {
  const queryKey = ['todos']
  return useQuery({ queryKey, queryFn: () => api.getTodos(filters) })
  //                ^^^^^^^^ ...missing in your queryKey: filters
}
```

Examples of **correct** code:

```tsx
import { useQuery } from '@tanstack/react-query'

function Todo({ todoId }) {
  const todos = useTodos()
  useQuery({
    queryKey: ['todo', todoId],
    queryFn: () => todos.getTodo(todoId), // `todos` is a call target: not a dependency
  })
}

const todos = createTodos()
const todoQueries = {
  detail: (id) => ({ queryKey: ['todo', id], queryFn: () => todos.getTodo(id) }),
}

// Key factories, template literals, object shorthands, `as const`, variables holding the key...
function useTodo(id: number) {
  const queryKey = todoKeys.detail({ id }) // resolved through the variable
  return useQuery({ queryKey, queryFn: () => fetchTodo(id) })
}
```

The diagnostic goes on the **`queryKey` value**: the array, the call, or the shorthand
`queryKey` member. Upstream puts it on the whole options object. All the missing names are listed
in a single message.

## Coverage vs. upstream

**Status: partial.** This is a structural approximation of a rule built on ESLint's scope
manager. Every upstream test case is ported to `tests/fixtures/exhaustive-deps/`, except the Vue
SFC (`.vue`) module-level cases and the `allowlist` options. Each ported case gives the upstream
outcome, with two differences: the deps list in the message names root identifiers, and one case is
a known false negative (the `state.foo` / `state.bar` case below). The rule leans toward precision:
when it cannot tell, it stays silent.

### Detected, as upstream

- An object literal with a `queryKey` member and an inline `queryFn` as direct members. The
  `queryFn` can be `() => ...`, `function () {}`, a method `queryFn() {}`, a parenthesized
  function `(async () => ...)`, or a ternary such as `c ? fn : skipToken`, `c ? skipToken : fn` or
  `c ? fnA : fnB`, in which case both function branches are scanned and the condition is not.
  Like upstream, the callee (`useQuery`, `queryOptions`, `createQuery`, `injectQuery`, a plain
  factory object...) and the file's imports are **not** checked: upstream wraps this rule in
  `detectTanstackQueryImports` but never uses that check to filter. `queryFn: fetchTodos` or
  `queryFn: makeFetcher(id)` is never scanned.
- A dependency is a value read inside the `queryFn` (`id`, `props.id`, `map[key]`, `` `${id}` ``,
  a `{ id }` shorthand, a read in a nested callback) whose name is declared **directly in the
  outermost enclosing function**. That covers its parameters (destructured or not, with or without
  defaults) and its top-level `const` / `let` / `var` / function / class declarations. Upstream
  checks the same thing with `scope.set.has(name)` on the outermost function. As in upstream:
  - module-level variables, imports and globals are never dependencies, and queries outside any
    function are never checked;
  - names declared only in a nested block or in an intermediate function are not dependencies;
  - names bound inside a parameter's type annotation (`onChange: (url: string) => void`), inside a
    default value (`render = (id) => id`) or inside a destructuring default are not declarations
    of the function;
  - class methods, getters, setters and constructors count as functions
    (`class S { m(id) { ... } }`), and so does a class property arrow (`load = (id) => ...`).
- Not dependencies: the root of a call target (`fetch(id)`, `api.todos.get(id)`, `a?.b!.c()`,
  `onDone?.()`), the direct callee and the direct arguments of `new` (`new Error(message)`; upstream
  skips any identifier whose parent is a `NewExpression`, so `new sdk.Client()` still needs `sdk`),
  both operands of `instanceof`, and `undefined`. A call target that is read again inside its own
  call's arguments is a dependency there: `date.format(date)` needs `date`, and
  `service.fetch(service.id)` needs `service`.
- A dependency counts as present when its name is read **anywhere** in the key: inside an array,
  an object (`{ id }`, `{ x: id }`, `{ ...filters }`), a template literal, a call argument
  (`todoKeys.detail(id)`, `factory(id ?? -1)`), a member chain (`props.id`, `api.createKey()`),
  a ternary or binary expression, `as` / `satisfies`, or a callback in the key
  (`() => obj.boo`). A read inside a key callback that re-binds the name (`ids.map((id) => id)`)
  does not count, as upstream.
- `queryKey: key`, the shorthand `queryKey`, and a key wrapped in up to three `as` / `satisfies` /
  `!` / `<T>` / parentheses (`key as const`, `key as unknown as QueryKey`, `(key)!`) are resolved to
  the declaration's initializer, as upstream's `dereferenceVariablesAndTypeAssertions` does. The
  declaration can be the only binding of that name in the outermost function, or a top-level
  (optionally exported) module `const` / `let` that the function does not shadow (in ES modules and
  in CommonJS scripts).
- Identifiers *inside* the key are not dereferenced, as upstream: with
  `const base = ['todos', filters]`, the key `[...base, page]` does not cover `filters`.

### Known false negatives (upstream reports, this port does not)

They are all deliberate: in each case GritQL cannot tell the difference structurally, and the rule
stays silent rather than guess.

- **Dependencies are compared by root name, not by member path.** Upstream requires the exact
  path when the key only has some members of an object. This port treats any read of the root in
  the key as covering every member:

  ```tsx
  function Component() {
    const state = { foo: 'foo', bar: 'bar' }
    useQuery({
      queryKey: ['state', state.foo], // upstream: "missing: state.bar"; this port: no report
      queryFn: () => Promise.resolve({ foo: state.foo, bar: state.bar }),
    })
  }
  ```

  For the same reason the message lists root names. It says `api` where upstream says
  `api.baseUrl`, and `map, key` where upstream says `map[key]`.
- **A same-named binding anywhere in the `queryFn` hides the outer variable.** Upstream resolves
  each reference separately, so here `id` outside the callback is still a dependency:

  ```tsx
  function Component({ id, ids }) {
    useQuery({
      queryKey: ['ids', ids],
      queryFn: () => Promise.all([fetchTodo(id), ...ids.map((id) => fetchTodo(id))]),
      // upstream: "missing: id"; this port: no report
    })
  }
  ```
- **Keys that cannot be resolved structurally are not checked.** That includes a key passed in
  as a parameter (`function useX(queryKey, id) { useQuery({ queryKey, queryFn: () => f(id) }) }`),
  a variable declared in more than one place in the outermost function (with different
  initializers), a module-level key shadowed in the function, an alias of an alias
  (`const a = b`, `const a = b as K`), a destructured key (`const { queryKey } = props`), and a key
  imported from another module. Upstream reports some of these.
- **Hoisted `var`** declared inside a nested block of the outermost function is not treated as
  declared in that function. Upstream does treat it as declared there.
- **`x++` / `x += 1`** inside the `queryFn` are not treated as reads. Upstream counts them.
- **`arguments`** of a non-arrow outermost function and **TS `enum`s** declared inside it are not
  treated as declared there. Upstream's scope manager lists both.
- **Text-based identity in exemptions.** GritQL compares a bound node with another by source text.
  When the same name is a direct argument of `new` and is read again elsewhere inside that `new`
  expression (`new Foo(id, f(id))`), both reads are exempt. Likewise an identifier that is both
  the object and a computed property of a call target (`key[key]()`) is exempt.
- **Call targets deeper than 8 member links** (`a.b.c.d.e.f.g.h.i.get(id)`) are accepted whatever
  their root, so a computed property inside such a chain (`a.b.c.d.e.f.g.h.i[k]()`) is not a
  dependency either. GritQL in Biome cannot recurse, so the chain is unrolled to a fixed depth.
- **No options.** `allowlist.variables` and `allowlist.types` cannot be expressed in a Biome
  plugin. Use a suppression comment instead (see below).
- **No module-level `.vue` `<script setup>` code.** Biome does lint the `<script>` blocks of
  `.vue` and `.svelte` files, and queries inside functions there are checked. But upstream also
  checks queries at the top level of a `.vue` file, against the file's top-level variables. A
  Biome plugin cannot tell which file type it is running on, so this port checks functions only,
  like upstream does for every other file type.

### Known differences that report more than upstream

- **A function nested in a non-function branch of a ternary `queryFn` is scanned.** For
  `queryFn: ready ? withRetry(() => api.getTodo(todoId)) : skipToken`, upstream skips the whole
  `withRetry(...)` branch; this port reports `todoId` when the key lacks it. The read is real: the
  query does depend on `todoId`.
- **Keys wrapped in more than three `as` / `satisfies` / `!` / parentheses** (`((((key))))`) are
  not resolved, so only the identifier itself is seen in the key. Biome's formatter removes such
  redundant parentheses; `key as unknown as QueryKey` (two wrappers) is resolved.

### Other differences

- Biome reports only one diagnostic per span. If two rules of the same composed preset had to
  report the same `queryKey` node, only the first would show. In this repository only this rule
  reports on the `queryKey` value.

## Fixes

None. Neither `--write` nor `--write --unsafe` changes the code.

Upstream offers an editor *suggestion* (never an automatic fix) that appends the missing paths to
the key array. This port does not:

- it knows root names, not the member paths upstream would append (`svc` instead of `svc.part`);
- adding a value to a query key changes the cache identity of the query, which is a decision for a
  human;
- the key is often a factory call or a variable, and there is nothing safe to append to.

## Suppressing

With the standalone plugin (`rules/exhaustive-deps.grit` in `biome.json`):

```tsx
// biome-ignore lint/plugin/exhaustive-deps: the client is stable for the app's lifetime
useQuery({ queryKey: ['todos'], queryFn: () => client.getTodos(filters) })
```

With a preset (`rules/index.grit` or `rules/recommended-strict.grit`), the category is named after
the preset file:

```tsx
// biome-ignore lint/plugin/index: the client is stable for the app's lifetime
useQuery({ queryKey: ['todos'], queryFn: () => client.getTodos(filters) })
```

Use `lint/plugin/recommended-strict` with the strict preset. `// biome-ignore lint/plugin: <reason>`
silences every plugin on the next line. Put the comment on the line before the line where the
`queryKey` value starts, because that is where the diagnostic is reported.

## Severity

`error`, the same as upstream's `recommended` and `recommended-strict` configs.

## Performance

Measured with Biome 2.5.15 on an Apple Silicon laptop, standalone plugin, generated React files:

| File | Queries | Reported | Time |
| --- | --- | --- | --- |
| 3,090 lines | 0 | 0 | ~0.35 s |
| 3,090 lines | 22 | 0 | ~0.47 s |
| 3,090 lines | 22 | 4 | ~0.81 s |
| 2,928 lines (very dense) | 204 | 0 | ~1.1 s |
| 2,928 lines (very dense) | 204 | 17 | ~3.8 s |

The rule never scans the whole file per node. It scans the key, the `queryFn` and the outermost
function, plus the file's top-level statements when the key is a module-level variable. Two Biome
engine costs dominate, and the rule's GritQL is written around them:

- **Every GritQL variable declared in the plugin file costs time on every syntax node**, whether
  or not the rule matches there (about 10 ms per variable on a 3,000-line file). This rule uses 14
  variables; the first port used 32 and took twice as long.
- **Each reported query costs extra time that grows with the file size** (about 80 ms per report
  on a 3,000-line file). Biome's engine causes this for every plugin whose entry point is a named
  pattern, which the preset composition requires. A file with dozens of violations can take a few
  seconds; fixing them makes the cost go away.

Both costs add up across rules in the composed presets (`index.grit`, `recommended-strict.grit`):
every rule pays for the variables of all the others. If lint time matters more than having a
single plugin entry, list the standalone rule files in `biome.json` instead.
