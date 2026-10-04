import {
  useQueries,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { useInfiniteQuery } from '@tanstack/vue-query'
import { useMemo } from 'react'

declare const api: { getTodos: () => Promise<string[]> }

// ---------------------------------------------------------------------------
// Ported from upstream: no-rest-destructuring.test.ts (invalid)
// ---------------------------------------------------------------------------

// useQuery is destructured with rest
export function UseQueryRest() {
  const { data, ...rest } = useQuery() // expect: no-rest-destructuring
  return
}

// useInfiniteQuery is destructured with rest (any @tanstack/*-query adapter)
export function UseInfiniteQueryRest() {
  const { data, ...rest } = useInfiniteQuery() // expect: no-rest-destructuring
  return
}

// useQueries array has rest destructured element
export function UseQueriesRest() {
  const [query1, { data, ...rest }] = useQueries([ // expect: no-rest-destructuring
    { queryKey: ['key1'], queryFn: () => {} },
    { queryKey: ['key2'], queryFn: () => {} },
  ])
  return
}

// useSuspenseQuery is destructured with rest
export function UseSuspenseQueryRest() {
  const { data, ...rest } = useSuspenseQuery() // expect: no-rest-destructuring
  return
}

// useSuspenseInfiniteQuery is destructured with rest
export function UseSuspenseInfiniteQueryRest() {
  const { data, ...rest } = useSuspenseInfiniteQuery() // expect: no-rest-destructuring
  return
}

// useSuspenseQueries is destructured with rest
export function UseSuspenseQueriesRest() {
  const [query1, { data, ...rest }] = useSuspenseQueries([ // expect: no-rest-destructuring
    { queryKey: ['key1'], queryFn: () => {} },
    { queryKey: ['key2'], queryFn: () => {} },
  ])
  return
}

// useQuery result is spread in return statement
export function SpreadInReturn() {
  const query = useQuery()
  return { ...query, data: query.data[0] } // expect: no-rest-destructuring
}

// useQuery result is spread in object expression
export function SpreadInObject() {
  const query = useQuery()
  const result = { ...query, data: query.data[0] } // expect: no-rest-destructuring
  return result
}

// query result is assigned then destructured with rest (upstream covers this
// through custom hooks with type information; the direct-hook form is the
// same code path)
export function StoredThenRest() {
  const todosQuery = useQuery()
  const { data, ...rest } = todosQuery // expect: no-rest-destructuring
  return null
}

// Upstream VALID cases for every hook (valid.tsx cannot import every hook
// from @tanstack): nothing in this function may be reported
export function UpstreamValidCases() {
  useQuery()
  useInfiniteQuery()
  useQueries([])
  useSuspenseQuery()
  useSuspenseInfiniteQuery()
  useSuspenseQueries([])
  const query = useQuery()
  const infiniteQuery = useInfiniteQuery()
  const queries = useQueries([])
  const suspenseQuery = useSuspenseQuery()
  const suspenseInfiniteQuery = useSuspenseInfiniteQuery()
  const suspenseQueries = useSuspenseQueries([])
  const { data: a, isLoading: b, isError: c } = useQuery()
  const { data: d, isLoading: e, isError: f } = useInfiniteQuery()
  const { data: g, isLoading: h, isError: i } = useSuspenseQuery()
  const { data: j, isLoading: k, isError: l } = useSuspenseInfiniteQuery()
  const [query1, { data: m, isLoading: n }, , ...others] = useQueries([
    { queryKey: ['key1'], queryFn: () => {} },
    { queryKey: ['key2'], queryFn: () => {} },
    { queryKey: ['key3'], queryFn: () => {} },
    { queryKey: ['key4'], queryFn: () => {} },
  ])
  const [query2, { data: o, isLoading: p }] = useSuspenseQueries([
    { queryKey: ['key1'], queryFn: () => {} },
    { queryKey: ['key2'], queryFn: () => {} },
  ])
  return [query, infiniteQuery, queries, suspenseQuery, suspenseInfiniteQuery, suspenseQueries, a, b, c, d, e, f, g, h, i, j, k, l, query1, m, n, others, query2, o, p]
}

// ---------------------------------------------------------------------------
// From the upstream documentation
// ---------------------------------------------------------------------------

export const useTodos = () => {
  const {
    data: todos,
    ...rest // expect: no-rest-destructuring
  } = useQuery({
    queryKey: ['todos'],
    queryFn: () => api.getTodos(),
  })
  return { todos, ...rest }
}

// ---------------------------------------------------------------------------
// Additional cases
// ---------------------------------------------------------------------------

// let / var declarations, type arguments, several declarators per statement
export function DeclarationKinds() {
  let { data: a, ...restA } = useQuery<string[]>({ queryKey: ['a'] }) // expect: no-rest-destructuring
  var { data: b, ...restB } = useSuspenseQuery({ queryKey: ['b'] }), { data: c, ...restC } = useQuery() // expect: no-rest-destructuring, no-rest-destructuring
  a = undefined
  return [a, b, c, restA, restB, restC]
}

// Several rest elements in one useQueries result
export function SeveralQueriesElements() {
  const [{ data: first, ...firstRest }, second, { data: third, ...thirdRest }] = useQueries({ queries: [] }) // expect: no-rest-destructuring, no-rest-destructuring
  return [first, firstRest, second, third, thirdRest]
}

// Arrow function components and custom hooks
export const ArrowComponent = () => {
  const infinite = useSuspenseInfiniteQuery({ queryKey: ['x'] })
  const { fetchNextPage, ...others } = infinite // expect: no-rest-destructuring
  return [fetchNextPage, others]
}

// A stored result used inside a closure of the same component
export function SpreadInClosure() {
  const query = useSuspenseQuery({ queryKey: ['y'] })
  const value = useMemo(() => ({ ...query }), [query]) // expect: no-rest-destructuring
  const handler = () => {
    if (value) {
      return { ...query } // expect: no-rest-destructuring
    }
  }
  return handler
}

// The same name in two components: each one is tracked on its own
export function First() {
  const query = useQuery()
  return { ...query } // expect: no-rest-destructuring
}

export function Second() {
  const query = useInfiniteQuery()
  return {
    ...query, // expect: no-rest-destructuring
    pages: query.data?.pages,
  }
}

// Type annotations and line breaks do not hide a stored result
export function Annotated() {
  const typed: UseQueryResult<string[]> = useQuery({ queryKey: ['typed'] })
  const wrapped =
    useSuspenseQuery({ queryKey: ['wrapped'] })
  return [{ ...typed }, { ...wrapped }] // expect: no-rest-destructuring, no-rest-destructuring
}

// ---------------------------------------------------------------------------
// Regression cases from the adversarial review
// ---------------------------------------------------------------------------

// A callback parameter whose pattern has the SAME TEXT as the declarator's
// pattern belongs to the callback: only the outer rest element is reported
export function SameTextInSelect() {
  const { ...r } = useQuery({ // expect: no-rest-destructuring
    queryKey: ['same-text'],
    select: ({ ...r }) => r,
  })
  return r
}

export function SameTextInCombine() {
  const [{ ...r }] = useQueries({ // expect: no-rest-destructuring
    queries: [],
    combine: ([{ ...r }]) => [r],
  })
  return r
}

// Spreads in JSX attribute values, event handlers, loops, arrays and call
// arguments (the last two as upstream: they are type errors anyway)
export function SpreadPlaces(flag: boolean, log: (...args: unknown[]) => void) {
  const query = useQuery({ queryKey: ['places'] })
  if (flag) {
    for (let i = 0; i < 2; i++) {
      log({ ...query }) // expect: no-rest-destructuring
    }
  }
  log(...query) // expect: no-rest-destructuring
  return (
    <Child
      value={{ ...query }} // expect: no-rest-destructuring
      onClick={() => log([...query])} // expect: no-rest-destructuring
    />
  )
}

// A `switch` that does not rebind the name does not hide the stored result
export function SwitchWithoutShadowing(kind: number) {
  const query = useSuspenseQuery({ queryKey: ['switch'] })
  switch (kind) {
    case 1:
      return { ...query } // expect: no-rest-destructuring
    default:
      return null
  }
}

// Object methods (e.g. Vue's `setup()`) are function bodies too; every
// `@tanstack/*-query` adapter is covered, as upstream
export const VueComponent = {
  setup() {
    const query = useInfiniteQuery({ queryKey: ['vue'] })
    return { ...query } // expect: no-rest-destructuring
  },
}

// A hook-named binding in an UNRELATED function does not hide the import
export function UnrelatedLocalHook() {
  const useSuspenseQuery = () => ({ data: 1 })
  return useSuspenseQuery().data
}

export function NotShadowedBySibling() {
  const { data, ...rest } = useSuspenseQuery({ queryKey: ['sibling'] }) // expect: no-rest-destructuring
  return [data, rest]
}

declare function Child(props: { value: unknown; onClick: () => void }): null
