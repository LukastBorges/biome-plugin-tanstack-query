import { useMutation, useMutationState, useQuery } from '@tanstack/react-query'
import { useMutation as useApolloMutation } from '@apollo/client'

declare const objectExpressionSpread: object
declare const myOptions: { mutationOptions: () => object }
declare function mutationOptions<T>(options: T): T
declare const trpc: { post: { create: { useMutation: (options: object) => unknown } } }
declare const ReactQuery: { useMutation: (options: object) => unknown }
declare const options: object

// --- Ported from the upstream test matrix ------------------------------------
// Every ordered combination of at least two checked callbacks is valid.

export function onMutateOnError() {
  return useMutation({
    onMutate: (data) => {
      return { foo: data }
    },
    onError: (error, variables, onMutateResult) => {
      console.log('error:', error, 'onMutateResult:', onMutateResult)
    },
  })
}

export function onMutateOnSettled() {
  return useMutation({
    onMutate: (data) => {
      return { foo: data }
    },
    onSettled: (data, error, variables, onMutateResult) => {
      console.log('settled', onMutateResult)
    },
  })
}

export function onMutateOnErrorOnSettled() {
  return useMutation({
    gcTime: 5 * 60 * 1000,
    onMutate: (data) => {
      return { foo: data }
    },
    ...objectExpressionSpread,
    onError: (error, variables, onMutateResult) => {
      console.log('error:', error, 'onMutateResult:', onMutateResult)
    },
    ...myOptions.mutationOptions(),
    onSettled: (data, error, variables, onMutateResult) => {
      console.log('settled', onMutateResult)
    },
  })
}

// The relative order of onError and onSettled does not matter.
export function onErrorAndOnSettledInAnyOrder() {
  useMutation({ onError: () => {}, onSettled: () => {} })
  useMutation({ onSettled: () => {}, onError: () => {} })
  return useMutation({ onMutate: () => ({}), onSettled: () => {}, onError: () => {} })
}

// Upstream regression test: a call expression spread containing other
// callbacks is opaque.
export function callExpressionSpread() {
  const { mutate } = useMutation({
    ...mutationOptions({
      retry: 3,
      onSuccess: () => console.log('success'),
    }),
    onMutate: (data) => {
      return { foo: data }
    },
    onError: (error, variables, onMutateResult) => {
      console.log(error, onMutateResult)
    },
    onSettled: (data, error, variables, onMutateResult) => {
      console.log('settled', onMutateResult)
    },
  })
  return mutate
}

// --- Near misses ---------------------------------------------------------------

// Only onError / onSettled, no onMutate: nothing to infer from.
export function noOnMutate() {
  return useMutation({ onSettled: () => {}, mutationFn: async () => 1, onError: () => {} })
}

// Unrelated callbacks are order-independent.
export function unrelatedCallbacks() {
  return useMutation({ onSuccess: () => {}, onMutate: () => ({}), retry: 3 })
}

// Spreads are opaque: an onError hidden in a spread is not "before" onMutate.
export function onErrorInsideSpread() {
  return useMutation({ ...mutationOptions({ onError: () => {} }), onMutate: () => ({}) })
}

// Nested objects are not the options object.
export function nestedObject() {
  return useMutation({ meta: { onError: 'a', onMutate: 'b' }, onMutate: () => ({}) })
}

// Quoted and computed keys are ignored, as upstream (it only looks at
// identifier keys).
export function quotedAndComputedKeys(key: 'onError') {
  useMutation({ 'onError': () => {}, onMutate: () => ({}) })
  return useMutation({ [key]: () => {}, onMutate: () => ({}) })
}

// Names that merely contain the checked ones.
export function similarNames() {
  useMutation({ onError: () => {}, onMutateLater: () => ({}) })
  return useMutation({ onErrorRetry: () => {}, xonSettled: () => {}, onSettledLater: () => {}, onMutate: () => ({}) })
}

// Not an inline object literal (upstream only inspects `arguments[0]` when it is
// an object expression).
export function notAnObjectLiteral() {
  useMutation(options)
  useMutation(mutationOptions({ onError: () => {}, onMutate: () => ({}) }))
  return useMutation(() => ({ onError: () => {}, onMutate: () => ({}) }) as never)
}

// The options object is not the first argument (TanStack Query v4-style
// `useMutation(fn, options)` is out of scope upstream too).
export function optionsAsSecondArgument(fn: () => Promise<void>) {
  return useMutation(fn as never, { onError: () => {}, onMutate: () => ({}) } as never)
}

// Member-expression callees (tRPC, namespace imports) are not checked upstream.
export function memberCallees() {
  trpc.post.create.useMutation({ onError: () => {}, onMutate: () => ({}) })
  return ReactQuery.useMutation({ onError: () => {}, onMutate: () => ({}) })
}

// Other hooks with the same callbacks.
export function otherHooks() {
  useMutationState({ filters: { status: 'error' }, select: (m) => m.state.error })
  return useQuery({ queryKey: ['x'], queryFn: () => 1, onError: () => {}, onMutate: () => {} } as never)
}

// An aliased import is not matched (upstream only matches the callee name),
// nor is another library's hook under a different local name.
export function aliasedImport() {
  return useApolloMutation({ onError: () => {}, onMutate: () => {} } as never)
}

// Parenthesized options in the right order.
export function parenthesizedValidOrder() {
  return useMutation(({ onMutate: () => ({}), onError: () => {} }))
}

// An object literal spread is opaque too, even an inline one.
export function inlineObjectSpread(onError: () => void) {
  return useMutation({ ...{ onError }, onMutate: () => ({}) })
}

// Callbacks of a nested hook call are checked against their own object only.
export function nestedCalls() {
  return useMutation({
    onMutate: () => ({}),
    onError: () => {
      useQuery({ queryKey: ['retry'], queryFn: () => 1, onError: () => {}, onMutate: () => {} } as never)
    },
  })
}

// Same callback names in an unrelated function call or object.
declare function track(event: object): void
export function unrelatedObjects() {
  track({ onError: () => {}, onMutate: () => {} })
  const handlers = { onSettled: () => {}, onMutate: () => {} }
  return handlers
}

// --- Suppressions ----------------------------------------------------------------
// `lint/plugin` works both standalone and in the presets. The rule-specific
// forms (`lint/plugin/mutation-property-order` standalone, `lint/plugin/index`
// in the preset) are covered by docs/rules/mutation-property-order.md.

export function suppressedAllPlugins() {
  return useMutation({
    // biome-ignore lint/plugin: legacy code, reordering later
    onSettled: () => {},
    onMutate: () => ({}),
  })
}
