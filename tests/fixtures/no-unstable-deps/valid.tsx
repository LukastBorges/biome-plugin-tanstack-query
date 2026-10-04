// Near misses for @tanstack/query/no-unstable-deps. `useQuery` and `useMutation` are
// deliberately imported from NON-TanStack modules here (upstream "imported from non-TanStack
// source" cases), so the TanStack hooks used below are the other five.
import * as React from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useMemo as useMemoFromPreact } from 'preact/hooks'
import type { useInfiniteQuery as useInfiniteQueryType } from '@tanstack/react-query'
import {
  useQueries,
  useSuspenseInfiniteQuery,
  useSuspenseQueries,
  useSuspenseQuery,
  useIsFetching,
  useQueryClient,
  useSuspenseQuery as useAliasedSuspenseQuery,
} from '@tanstack/react-query'
import { useInfiniteQuery } from '@tanstack/query-core'
import { useMutation } from './api'
import { useQuery } from './router'
import { useImportedQuery } from './hooks'

// Upstream: destructured values are stable and fine as dependencies.
export function Destructured() {
  const { refetch } = useSuspenseQuery({ queryKey: ['a'], queryFn: () => 'a' })
  const { fetchNextPage } = useSuspenseInfiniteQuery({
    queryKey: ['b'],
    queryFn: () => 'b',
    initialPageParam: 0,
    getNextPageParam: () => 1,
  })
  const callback = useCallback(() => {
    refetch()
  }, [refetch])
  React.useEffect(() => {
    fetchNextPage()
  }, [fetchNextPage])
  return callback
}

// Upstream: useQueries / useSuspenseQueries with `combine` return what `combine` returns.
export function WithCombine() {
  const queries = useQueries({
    queries: [{ queryKey: ['test'], queryFn: () => 'test' }],
    combine: (results) => ({ data: results[0]?.data }),
  })
  const suspenseQueries = useSuspenseQueries({
    queries: [{ queryKey: ['test'], queryFn: () => 'test' }],
    combine(results) {
      return results.length
    },
  })
  const combine = (results: unknown[]) => results.length
  const shorthand = useQueries({ queries: [], combine })
  return useMemo(() => [queries.data, suspenseQueries, shorthand], [queries, suspenseQueries, shorthand])
}

// Upstream: object-destructured elements of array-destructured useQueries.
export function ArrayDestructuredProperties() {
  const [{ data }] = useQueries({
    queries: [{ queryKey: ['test'], queryFn: () => 'test' }],
  })
  // Defaults and nested patterns are not tracked upstream either.
  const [first = null, [nested] = [], ...[restFirst]] = useQueries({ queries: [] })
  return useCallback(() => data, [data, first, nested, restFirst])
}

// Upstream: useQuery / useMutation imported from non-TanStack sources.
export function NonTanstackSources() {
  const query = useQuery()
  const mutation = useMutation()
  const infinite = useInfiniteQuery()
  useEffect(() => {
    query.refetch()
    mutation.mutate()
  }, [query, mutation, infinite])
}

// Upstream: functions or variables with Object.prototype names.
function toString() {
  return 'formatted'
}

export function ObjectPrototypeNames() {
  const valueOf = 42
  const res = toString()
  const { data } = useSuspenseQuery({ queryKey: ['test'], queryFn: () => 'test' })
  const callback = useCallback(() => res, [toString, valueOf, res, data])
  return callback
}

// Only bare identifiers are reported: members, calls, spreads, nested arrays are not.
export function NonIdentifierDependencies() {
  const query = useSuspenseQuery({ queryKey: ['a'], queryFn: () => 'a' })
  const queries = useQueries({ queries: [] })
  useEffect(() => {}, [query.data, query?.status, String(query), query!, [query], { query }])
  useEffect(() => {}, [...queries])
}

// Hooks that are not useEffect / useMemo / useCallback, or not React's.
export function OtherHooks() {
  const query = useSuspenseQuery({ queryKey: ['a'], queryFn: () => 'a' })
  React.useLayoutEffect(() => {}, [query])
  useEffectEvent(() => {}, [query])
  useMemoFromPreact(() => query.data, [query])
  ReactDOM.useMemo(() => query.data, [query])
  useMemoized(() => query.data, [query])
  useEffect(() => {
    query.refetch()
  })
  return useCallback(() => query)
}

// Hooks not covered by the rule, aliased TanStack hooks, and type-only imports.
export function OtherTanstackHooks() {
  const client = useQueryClient()
  const fetching = useIsFetching()
  const aliased = useAliasedSuspenseQuery({ queryKey: ['a'], queryFn: () => 'a' })
  const typed = useInfiniteQueryType()
  return useMemo(() => [client, fetching, aliased, typed], [client, fetching, aliased, typed])
}

// Names are resolved to the NEAREST scope declaring them: a parameter of a nested function
// shadows the query result.
export function Owner() {
  const query = useSuspenseQuery({ queryKey: ['a'], queryFn: () => 'a' })
  function Inner(query: unknown) {
    return useMemo(() => query, [query])
  }
  return Inner
}

export function OtherComponentSameName() {
  const query = { data: 1 }
  return useMemo(() => query.data, [query])
}

// Values that merely wrap a query result are not tracked (only direct calls are).
export function Wrapped() {
  const query = useSuspenseQuery({ queryKey: ['a'], queryFn: () => 'a' }) as unknown
  const data = useSuspenseQuery({ queryKey: ['b'], queryFn: () => 'b' }).data
  const both = [useSuspenseQuery({ queryKey: ['c'], queryFn: () => 'c' })]
  return useMemo(() => [query, data, both], [query, data, both])
}

// Custom hooks only count when they directly return a TanStack Query hook call.
function useTodoData() {
  return useSuspenseQuery({ queryKey: ['todos'], queryFn: () => 'todos' }).data
}

const useCombined = () =>
  useQueries({
    queries: [],
    combine: (results) => results.length,
  })

function useLocalQuery() {
  return useQuery()
}

function getQuery() {
  return useSuspenseQuery({ queryKey: ['x'], queryFn: () => 'x' })
}

function useIndirect() {
  const query = useSuspenseQuery({ queryKey: ['y'], queryFn: () => 'y' })
  return query
}

function useNested() {
  function inner() {
    return useSuspenseQuery({ queryKey: ['z'], queryFn: () => 'z' })
  }
  return inner
}

export function CustomHooks() {
  const todos = useTodoData()
  const combined = useCombined()
  const local = useLocalQuery()
  const plain = getQuery()
  const indirect = useIndirect()
  const nested = useNested()
  const imported = useImportedQuery()
  return useMemo(
    () => [todos, combined, local, plain, indirect, nested, imported],
    [todos, combined, local, plain, indirect, nested, imported],
  )
}

// Shadowing (regression: these used to be reported). Parameters of expression-bodied arrows,
// destructured parameters, block-scoped constants, catch and for-of bindings all shadow the
// query result declared by the component.
export function ShadowedByNestedBindings({ ids, list }: { ids: string[]; list: unknown[] }) {
  const query = useSuspenseQuery({ queryKey: ['a'], queryFn: () => 'a' })
  const mapped = ids.map((query) => useMemo(() => query, [query]))
  const byObject = ({ query }: { query: unknown }) => useMemo(() => query, [query])
  const byArray = ([query]: unknown[]) => useMemo(() => query, [query])
  const byRest = (...query: unknown[]) => useMemo(() => query, [query])
  {
    const query = { data: 1 }
    useEffect(() => {}, [query])
  }
  try {
    console.info(list)
  } catch (query) {
    useEffect(() => {}, [query])
  }
  for (const query of list) {
    useEffect(() => {}, [query])
  }
  function Inner() {
    const query = { data: 2 }
    const { query: renamed } = { query: 3 }
    function useNothing() {}
    return useMemo(() => [query, renamed, useNothing], [query, renamed, useNothing])
  }
  return [query, mapped, byObject, byArray, byRest, Inner]
}

// A query declared inside a block is out of scope after it.
export function OutOfScope(enabled: boolean) {
  if (enabled) {
    const blockQuery = useSuspenseQuery({ queryKey: ['a'], queryFn: () => 'a' })
    console.info(blockQuery)
  }
  // @ts-expect-error blockQuery is not defined here
  useEffect(() => {}, [blockQuery])
}

// A local function or parameter with the name of a TanStack hook or of a wrapper shadows it.
function useSuspenseTodos() {
  return useSuspenseQuery({ queryKey: ['todos'], queryFn: () => 'todos' })
}

export function ShadowedHooks({ useSuspenseQueries }: { useSuspenseQueries: () => unknown }) {
  function useSuspenseQuery() {
    return { data: 1 }
  }
  const useSuspenseTodos = () => ({ data: 2 })
  const local = useSuspenseQuery()
  const fromProps = useSuspenseQueries()
  const todos = useSuspenseTodos()
  return useMemo(() => [local, fromProps, todos], [local, fromProps, todos])
}

export function WrapperFromProps({ useSuspenseTodos }: { useSuspenseTodos: () => unknown }) {
  const todos = useSuspenseTodos()
  return useMemo(() => todos, [todos])
}
