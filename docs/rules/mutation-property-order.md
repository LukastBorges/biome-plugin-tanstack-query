# `@tanstack/query/mutation-property-order`

Ensure correct order of inference-sensitive properties in `useMutation()`.

- Upstream rule: [`@tanstack/query/mutation-property-order`](https://tanstack.com/query/latest/docs/eslint/mutation-property-order)
- Plugin file: [`rules/mutation-property-order.grit`](../../rules/mutation-property-order.grit)
- Included in presets: `index.grit` (recommended), `recommended-strict.grit`

## Rule details

TypeScript infers the type of the value returned by `onMutate` (the "mutation
context" that `onError` and `onSettled` receive as `onMutateResult`) from the
object literal in source order. If `onError` or `onSettled` comes before
`onMutate`, inference of the context type breaks. The required order is:

1. `onMutate`
2. `onError` and `onSettled`, in either order

All other properties (`mutationFn`, `retry`, `gcTime`, spreads, ...) are
order-independent and may appear anywhere.

The diagnostic is reported on the **first property that is out of order**: the
first `onError` / `onSettled` that has an `onMutate` after it.

Examples of **incorrect** code for this rule:

```tsx
import { useMutation } from '@tanstack/react-query'

const mutation = useMutation({
  mutationFn: () => Promise.resolve('success'),
  onSettled: () => {
    // ^^^^^^^ @tanstack/query/mutation-property-order: Invalid order of properties for `useMutation`.
    results.push('onSettled-promise')
    return Promise.resolve('also-ignored') // Promise<string> (should be ignored)
  },
  onMutate: async () => {
    results.push('onMutate-async')
    await sleep(1)
    return { backup: 'async-data' }
  },
  onError: async () => {
    results.push('onError-async-start')
    await sleep(1)
    results.push('onError-async-end')
  },
})
```

```tsx
useMutation({ onError, onMutate })
useMutation({ onSettled() {}, retry: 3, onMutate() {} })
```

Examples of **correct** code for this rule:

```tsx
import { useMutation } from '@tanstack/react-query'

const mutation = useMutation({
  mutationFn: () => Promise.resolve('success'),
  onMutate: async () => {
    results.push('onMutate-async')
    await sleep(1)
    return { backup: 'async-data' }
  },
  onError: async () => {
    results.push('onError-async-start')
    await sleep(1)
    results.push('onError-async-end')
  },
  onSettled: () => {
    results.push('onSettled-promise')
    return Promise.resolve('also-ignored') // Promise<string> (should be ignored)
  },
})
```

```tsx
// onError / onSettled may appear in any relative order
useMutation({ onMutate, onSettled, onError })
// without onMutate there is nothing to infer from
useMutation({ onSettled, onError })
// spreads are opaque, even if they contain callbacks
useMutation({ ...mutationOptions({ onError }), onMutate })
```

## Coverage vs. upstream

**Status: full** (detection). Detection is a faithful port of the upstream
rule; the differences are a few syntactic edge cases listed below and the
fixer (see [Fixes](#fixes)).

Detected, exactly like upstream:

- Any call whose callee is the bare identifier `useMutation`, including
  `useMutation<TData, TError, TVariables, TContext>(...)`, optional calls
  (`useMutation?.(...)`) and calls with extra arguments
  (`useMutation(options, queryClient)`): only the first argument is
  inspected, and only when it is an inline object literal (optionally wrapped
  in one pair of parentheses, which ESTree drops).
- `onMutate`, `onError` and `onSettled` written as `key: value`, shorthand
  (`onError,`), methods (`onError() {}`, `async onError() {}`) or accessors
  (`get onError() {}`).
- Every order in which an `onError` / `onSettled` precedes an `onMutate`,
  including `onError, onSettled, onMutate`, duplicate keys, and objects
  interleaved with order-independent properties and the three kinds of spread
  used upstream (`...object`, `...mutationOptions({...})`,
  `...my.mutationOptions()`).
- `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, and the
  `<script>` blocks of `.vue` / `.svelte` files that Biome lints.

How this was verified: upstream's test file generates its invalid cases from
a permutation matrix, but its filters remove every permutation, so in
5.104.1 the upstream suite asserts no invalid case at all. This port was
instead checked against all 976 invalid and 800 valid orderings of every
subset of `onMutate` / `onError` / `onSettled` (at least two), interleaved
with `gcTime` and the three spread kinds. Every invalid ordering got exactly
one diagnostic on the expected property, every valid one none, and every
`--write` result equals upstream's fixer output or the documented partial
result (see [Fixes](#fixes)). The fixtures contain a representative subset.

Not import-aware, **like upstream**: although the upstream rule is wrapped in
`detectTanstackQueryImports`, `createPropertyOrderRule` never consults the
import helpers, so upstream (5.104.1) checks every `useMutation` regardless of
where it was imported from. This port does the same, which also covers
wrappers that re-export TanStack's hook (`import { useMutation } from
'~/lib/query'`), CommonJS `require`, and the Vue adapter. Only an options
object that contains both `onMutate` and `onError`/`onSettled` in the wrong
order is flagged. Any API shaped like that, for example Pinia Colada's
`useMutation({ mutation, onMutate, onError })` or `react-query` v3's object
form, has the same TypeScript inference problem, so a report there is
still useful, as it is upstream.

Not detected (same as upstream, listed here so nobody expects them):

```tsx
// Aliased imports and member callees: the callee must be the identifier `useMutation`.
import { useMutation as useM } from '@tanstack/react-query'
useM({ onError, onMutate })
trpc.post.create.useMutation({ onError, onMutate })
ReactQuery.useMutation({ onError, onMutate }) // also `import * as ReactQuery`

// Options that are not an inline object literal.
useMutation(options)
useMutation(mutationOptions({ onError, onMutate }))
useMutation(() => ({ onError, onMutate })) // Solid-style accessor
useMutation({ onError, onMutate } as const) // TS wrappers hide the object upstream too

// Quoted keys are not treated as the callbacks (upstream only reads identifier keys).
useMutation({ 'onError': handler, onMutate })

// Other adapters' hooks have other names (createMutation, injectMutation).
```

Differences from upstream (edge cases only):

- Computed keys: upstream reads the identifier of a computed key, so it treats
  `{ [onError]: fn, onMutate }` as an `onError` property (a false positive in
  upstream, since the runtime key is the variable's value). This port ignores
  computed keys.
- Parentheses: one pair around the options object is unwrapped
  (`useMutation(({ onError, onMutate }))` is reported and fixed). Two or more
  pairs, and a parenthesized callee (`(useMutation)({ ... })`), are not
  checked. ESTree drops all parentheses, so upstream checks both. Biome's
  formatter removes such parentheses anyway.

## Fixes

Upstream's fixer re-sorts `onMutate` / `onError` / `onSettled` into the slots
those properties occupy, keeping every other property, comment and separator
in place and keeping the relative order of `onError` and `onSettled`.

`biome lint --write` (safe fix) produces the **same output**, with these
implementation details:

- GritQL cannot sort a list in one rewrite, so each pass swaps one late
  callback with the `onMutate` that immediately follows it (ignoring unrelated
  properties). Biome re-lints after each applied fix, so the swaps converge to
  the upstream result, e.g.

  ```tsx
  useMutation({ onSettled, onError, gcTime: 1, onMutate })
  // --write ->
  useMutation({ onMutate, onSettled, gcTime: 1, onError })
  ```

- Comments between properties stay in their slot (upstream behaves the same),
  so a comment describing `onError` may end up above `onMutate`. Comments
  inside a property's value move with it.

A swap is **withheld** when it could change runtime behaviour. Upstream
fixes these cases anyway:

```tsx
// a spread or computed key between the swapped properties could redefine a key
useMutation({ onError, ...defaults, onMutate })
useMutation({ onError, [key]: value, onMutate })
// a quoted duplicate key between them
useMutation({ onError: a, 'onError': b, onMutate })
// a moved value has side effects, so swapping changes evaluation order
useMutation({ onError: createErrorHandler(), onMutate })
useMutation({ onError: makeHandlers().onError, onMutate })
```

Values considered side-effect free: arrow functions, function expressions,
literals, references (`handler`, `this.onError`, `handlers.onError`,
`handlers?.onError`; a chain of plain property reads with no call or
computed access), and shorthand / method / accessor members. Moving a
reference across other properties assumes those properties do not reassign
the referenced variable.

Every other safe swap in the same object is still applied, so `--write` can
fix an object **partially**. The diagnostic stays until the rest is fixed by
hand:

```tsx
useMutation({ onSettled, ...defaults, onError, onMutate })
// --write ->
useMutation({ onSettled, ...defaults, onMutate, onError }) // still reported
```

No fix is offered for **textually identical** duplicate callbacks
(`{ onSettled, onError, onSettled, onMutate }`): GritQL compares bound list
elements by text, so the property to move cannot be identified. Biome's
`noDuplicateObjectKeys` reports these objects anyway.

There is deliberately no unsafe fix.

Known Biome 2.5.15 quirk: Biome bundles all rewrites of one plugin file into
the code action of the **first** plugin diagnostic in the file, and that
diagnostic's fix kind decides when the bundle is applied. If the first
diagnostic of the file has no fix (one of the cases above), plain `--write`
applies no fix from that plugin in that file until the first violation is
fixed by hand, while `--write --unsafe` applies the bundled (safe) swaps. In
the composed presets the bundle also includes other rules' rewrites, so mixing
rules with different fix kinds in one file can apply more or fewer fixes than
each diagnostic advertises.

## Performance

On a file without violations the rule costs next to nothing: a 2,750-line
file with 250 `useMutation` calls lints in about 0.25 s, the same as with no
plugin at all. Each violation adds a cost proportional to the file size,
because of how Biome 2.5.15 evaluates a plugin whose entry point is a named
pattern. The rule binds only four GritQL variables to keep that cost low. On
the same 2,750-line file, 21 violations take about 0.8 s and 125 violations
(every other call) about 3.8 s. The safe fix needs several passes for some
objects, and `--write` re-lints the file after each one.

## Suppressing

The diagnostic starts on the out-of-order property, so the suppression
comment has to go on the line directly above **that property**, not above the
`useMutation(` call (unless both are on the same line).

When using the standalone plugin (`rules/mutation-property-order.grit`):

```tsx
useMutation({
  // biome-ignore lint/plugin/mutation-property-order: legacy code, reordering later
  onError: () => {},
  onMutate: () => ({}),
})
```

When using a preset (`rules/index.grit` or `rules/recommended-strict.grit`), the
category is named after the preset file:

```tsx
useMutation({
  // biome-ignore lint/plugin/index: legacy code, reordering later
  onError: () => {},
  onMutate: () => ({}),
})
```

`// biome-ignore lint/plugin: <reason>` works with both but silences every
plugin rule on that line.

## Severity

`error`, matching the upstream `recommended` and `recommended-strict` configs.
