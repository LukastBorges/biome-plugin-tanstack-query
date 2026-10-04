import { useMutation } from '@tanstack/react-query'

declare const objectExpressionSpread: object
declare const myOptions: { mutationOptions: () => object }
declare function mutationOptions<T>(options: T): T
declare function sleep(ms: number): Promise<void>
declare function handleError(): (error: Error) => void
declare const results: string[]
declare const handlers: { onError: () => void; onMutate: () => void } | undefined
declare function makeHandlers(): { onError: () => void }

// NOTE: every case in the first part has a safe fix (applied by
// `biome lint --write`). Report-only cases are grouped at the end of the file:
// see docs/rules/mutation-property-order.md#fixes for why the order matters.

// --- Ported from the upstream test matrix ------------------------------------
// The upstream suite generates every invalid permutation of the three checked
// callbacks, interleaved with order-independent properties and spreads.

export function onErrorBeforeOnMutate() {
  return useMutation({
    onError: (error, variables, onMutateResult) => { // expect: mutation-property-order
      console.log('error:', error, 'onMutateResult:', onMutateResult)
    },
    onMutate: (data) => {
      return { foo: data }
    },
  })
}

export function onSettledBeforeOnMutate() {
  return useMutation({
    onSettled: (data, error, variables, onMutateResult) => { // expect: mutation-property-order
      console.log('settled', onMutateResult)
    },
    onMutate: (data) => {
      return { foo: data }
    },
  })
}

export function onErrorOnMutateOnSettled() {
  return useMutation({
    onError: (error, variables, onMutateResult) => { // expect: mutation-property-order
      console.log('error:', error, 'onMutateResult:', onMutateResult)
    },
    onMutate: (data) => {
      return { foo: data }
    },
    onSettled: (data, error, variables, onMutateResult) => {
      console.log('settled', onMutateResult)
    },
  })
}

export function onSettledOnMutateOnError() {
  return useMutation({
    onSettled: (data, error, variables, onMutateResult) => { // expect: mutation-property-order
      console.log('settled', onMutateResult)
    },
    onMutate: (data) => {
      return { foo: data }
    },
    onError: (error, variables, onMutateResult) => {
      console.log('error:', error, 'onMutateResult:', onMutateResult)
    },
  })
}

// Interleaved with an order-independent property: it keeps its slot.
export function interleavedWithGcTime() {
  return useMutation({
    onError: (error, variables, onMutateResult) => { // expect: mutation-property-order
      console.log('error:', error, 'onMutateResult:', onMutateResult)
    },
    gcTime: 5 * 60 * 1000,
    onMutate: (data) => {
      return { foo: data }
    },
    onSettled: (data, error, variables, onMutateResult) => {
      console.log('settled', onMutateResult)
    },
  })
}

// Spreads before or after the swapped pair cannot redefine a moved key.
export function spreadsOutsideTheSwappedRange() {
  return useMutation({
    ...objectExpressionSpread,
    onSettled: (data, error, variables, onMutateResult) => { // expect: mutation-property-order
      console.log('settled', onMutateResult)
    },
    onMutate: (data) => {
      return { foo: data }
    },
    ...mutationOptions({
      onSuccess: () => {},
      retry: 3,
    }),
    onError: (error, variables, onMutateResult) => {
      console.log('error:', error, 'onMutateResult:', onMutateResult)
    },
    ...myOptions.mutationOptions(),
  })
}

// --- Both late callbacks before onMutate (upstream flags these too; its test
// generator just skips them). onError / onSettled keep their relative order.

export function onErrorOnSettledOnMutate() {
  return useMutation({
    mutationFn: () => Promise.resolve('success'),
    onError: (error, variables, onMutateResult) => { // expect: mutation-property-order
      console.log('error:', error, 'onMutateResult:', onMutateResult)
    },
    onSettled: (data, error, variables, onMutateResult) => {
      console.log('settled', onMutateResult)
    },
    onMutate: (data) => {
      return { foo: data }
    },
  })
}

// The example from the upstream documentation.
export function upstreamDocsExample() {
  const mutation = useMutation({
    mutationFn: () => Promise.resolve('success'),
    onSettled: () => { // expect: mutation-property-order
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
  return mutation
}

// --- Other member shapes ------------------------------------------------------

// Shorthand properties, methods and identifiers, on a single line.
export function shorthandAndMethods(onError: () => void, onMutate: () => void) {
  useMutation({ onError, onMutate }) // expect: mutation-property-order
  useMutation({ onSettled() {}, retry: 3, onMutate() {} }) // expect: mutation-property-order
  useMutation({ onError: handlers?.onError, onMutate: handlers?.onMutate }) // expect: mutation-property-order
}

// One level of parentheses around the options object. ESTree drops
// parentheses, so upstream sees (and fixes) this object too.
export function parenthesizedOptions(onError: () => void, onMutate: () => void) {
  return useMutation(({ onError, onMutate })) // expect: mutation-property-order
}

// Multiple onMutate keys: the late callback is moved past the first one.
export function duplicateOnMutate(onSettled: () => void) {
  return useMutation({ onMutate: () => ({ a: 1 }), onSettled, onMutate: () => ({ b: 2 }) }) // expect: mutation-property-order
}

// Explicit type arguments and extra arguments (only the first is inspected).
export function typeArgumentsAndQueryClient(queryClient: unknown) {
  return useMutation<string, Error, number, { foo: number }>(
    {
      onError: () => {}, // expect: mutation-property-order
      onMutate: (variables) => ({ foo: variables }),
    },
    queryClient as never,
  )
}

// Comments stay in their slots, like upstream's fixer.
export function withComments() {
  return useMutation({
    // runs on failure
    onError: () => {}, // expect: mutation-property-order
    /* runs first */
    onMutate: () => ({ rollback: true }),
  })
}

// --- Report-only: no safe fix -------------------------------------------------
// Upstream fixes these too, but reordering them could change behaviour, so
// we only report them (see the docs). Keep them LAST in this file.

export function spreadBetweenTheSwappedPair() {
  return useMutation({
    onError: () => {}, // expect: mutation-property-order
    ...objectExpressionSpread,
    onMutate: () => ({}),
  })
}

export function callExpressionSpreadBetween() {
  return useMutation({
    onSettled: () => {}, // expect: mutation-property-order
    ...mutationOptions({
      onSuccess: () => {},
      retry: 3,
    }),
    onMutate: () => ({}),
  })
}

export function sideEffectfulValue() {
  return useMutation({
    onError: handleError(), // expect: mutation-property-order
    onMutate: () => ({}),
  })
}

export function computedKeyBetween(key: string) {
  return useMutation({
    onError: () => {}, // expect: mutation-property-order
    [key]: true,
    onMutate: () => ({}),
  })
}

// A call inside a property chain has side effects: moving it would reorder
// them relative to the other properties.
export function callInsideMemberChain() {
  return useMutation({
    onError: makeHandlers().onError, // expect: mutation-property-order
    retry: 3,
    onMutate: () => ({}),
  })
}

// Textually identical duplicate keys: GritQL compares bound list elements by
// text, so the swap target is ambiguous and no fix is offered.
export function identicalDuplicateCallbacks(onError: () => void, onSettled: () => void, onMutate: () => void) {
  return useMutation({ onSettled, onError, onSettled, onMutate }) // expect: mutation-property-order
}

// Partial fix: onError can be swapped with onMutate, but onSettled cannot be
// moved across the spread. `--write` performs the safe swap and the rest is
// still reported.
export function partialFix() {
  return useMutation({
    onSettled: () => {}, // expect: mutation-property-order
    ...objectExpressionSpread,
    onError: () => {},
    onMutate: () => ({}),
  })
}
