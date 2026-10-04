import * as React from 'react'
import { useCallback, useEffect, useMemo, useCallback as useStableCallback } from 'react'
import { useMemo as useMemoAlias } from 'React'
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from '@tanstack/react-query'

// Upstream: result of useMutation is passed to <react hook> as dependency.
export function MutationInUseCallback() {
  const mutation = useMutation({ mutationFn: (value: string) => value })
  const callback = useCallback(() => {
    mutation.mutate('hello')
  }, [mutation]) // expect: no-unstable-deps
  return callback
}

export function MutationInReactNamespace() {
  const mutation = useMutation({ mutationFn: (value: string) => value })
  return React.useMemo(() => mutation.status, [mutation]) // expect: no-unstable-deps
}

export function MutationInAliasedHook() {
  const mutation = useMutation({ mutationFn: (value: string) => value })
  return useStableCallback(() => mutation.mutate('hello'), [mutation]) // expect: no-unstable-deps
}

// Upstream: result of every query hook is passed to <react hook> as dependency.
export function EveryQueryHook() {
  const query = useQuery({ queryKey: ['a'], queryFn: () => 'a' })
  const suspenseQuery = useSuspenseQuery({ queryKey: ['b'], queryFn: () => 'b' })
  const queries = useQueries({ queries: [] })
  const suspenseQueries = useSuspenseQueries({ queries: [] })
  const infiniteQuery = useInfiniteQuery({
    queryKey: ['c'],
    queryFn: () => 'c',
    initialPageParam: 0,
    getNextPageParam: () => 1,
  })
  const suspenseInfiniteQuery = useSuspenseInfiniteQuery({
    queryKey: ['d'],
    queryFn: () => 'd',
    initialPageParam: 0,
    getNextPageParam: () => 1,
  })

  useEffect(() => {
    query.refetch()
  }, [query]) // expect: no-unstable-deps
  React.useEffect(() => {
    suspenseQuery.refetch()
  }, [suspenseQuery]) // expect: no-unstable-deps
  const first = useMemo(() => queries[0]?.data, [queries]) // expect: no-unstable-deps
  const second = useMemoAlias(() => suspenseQueries[0]?.data, [suspenseQueries]) // expect: no-unstable-deps
  const next = React.useCallback(() => infiniteQuery.fetchNextPage(), [infiniteQuery]) // expect: no-unstable-deps
  const more = useCallback(() => suspenseInfiniteQuery.fetchNextPage(), [suspenseInfiniteQuery]) // expect: no-unstable-deps
  return { first, second, next, more }
}

// Every offending element of one dependency array is reported, each on its own span.
export function SeveralUnstableDeps() {
  const query = useQuery({ queryKey: ['a'], queryFn: () => 'a' })
  const mutation = useMutation({ mutationFn: (value: string) => value })
  const { data } = useQuery({ queryKey: ['b'], queryFn: () => 'b' })
  useEffect(() => {
    mutation.mutate(String(query.data ?? data))
  }, [query, data, query.data, mutation]) // expect: no-unstable-deps, no-unstable-deps
  // A dependency array spanning several lines: the diagnostic starts on the identifier's line.
  useEffect(
    () => {
      query.refetch()
    },
    [
      data,
      query, // expect: no-unstable-deps
    ],
  )
}

// Upstream: custom wrappers of query hooks, declared before or after the component.
const useMyMutation = () => useMutation({ mutationFn: (value: string) => value })

function useMyQuery() {
  return useQuery({ queryKey: ['todos'], queryFn: () => 'todos' })
}

export const useMyQueries = function useMyQueriesImpl() {
  const queries = [{ queryKey: ['a'], queryFn: () => 'a' }]
  return useQueries({ queries })
}

export function CustomHooks() {
  const mutation = useMyMutation()
  const query = useMyQuery()
  const queries = useMyQueries()
  const later = useLaterQuery()
  const laterMutation = useLaterMutation()
  useEffect(() => {}, [mutation]) // expect: no-unstable-deps
  useEffect(() => {}, [query]) // expect: no-unstable-deps
  useEffect(() => {}, [queries]) // expect: no-unstable-deps
  useEffect(() => {}, [later]) // expect: no-unstable-deps
  useEffect(() => {}, [laterMutation]) // expect: no-unstable-deps
}

export default function useLaterQuery() {
  return useQuery({ queryKey: ['later'], queryFn: () => 'later' })
}

function useLaterMutation() {
  if (Math.random() > 2) {
    console.info('nested returns are ignored, like upstream')
  }
  return useMutation({ mutationFn: (value: string) => value })
}

// Upstream: useQueries without `combine` returns an unstable array.
export function QueriesWithoutCombine() {
  const queries = useQueries({
    queries: [{ queryKey: ['test'], queryFn: () => 'test' }],
  })
  return useCallback(() => queries[0]?.data, [queries]) // expect: no-unstable-deps
}

// Upstream: array-destructured useQueries / useSuspenseQueries elements, including rest.
export function ArrayDestructuredQueries() {
  const [userQuery, postsQuery] = useQueries({
    queries: [
      { queryKey: ['user'], queryFn: () => 'user' },
      { queryKey: ['posts'], queryFn: () => 'posts' },
    ],
  })
  const [query] = useSuspenseQueries({
    queries: [{ queryKey: ['test'], queryFn: () => 'test' }],
  })
  const [, secondQuery, ...restQueries] = useQueries({ queries: [] })
  useEffect(() => {}, [userQuery, postsQuery]) // expect: no-unstable-deps, no-unstable-deps
  useEffect(() => {}, [query]) // expect: no-unstable-deps
  useEffect(() => {}, [secondQuery, restQueries]) // expect: no-unstable-deps, no-unstable-deps
}

// Declaration forms upstream also tracks: let / var, multiple declarators, type annotations
// and type arguments, extra React hook arguments.
export function DeclarationForms() {
  let reassigned = useQuery({ queryKey: ['a'], queryFn: () => 'a' })
  var legacy = useQuery({ queryKey: ['b'], queryFn: () => 'b' })
  const id = 1,
    second = useQuery({ queryKey: ['c', id], queryFn: () => 'c' })
  const typed: ReturnType<typeof useQuery<string>> = useQuery<string>({ queryKey: ['d'], queryFn: () => 'd' })
  useEffect(() => {
    reassigned = useQuery({ queryKey: ['e'], queryFn: () => 'e' })
  }, [reassigned, legacy, second, typed]) // expect: no-unstable-deps, no-unstable-deps, no-unstable-deps, no-unstable-deps
  useMemo(() => legacy, [legacy], 'extra argument') // expect: no-unstable-deps
}

// Arrow components and hooks called from an arrow with an expression body.
export const ArrowComponent = () => {
  const query = useQuery({ queryKey: ['a'], queryFn: () => 'a' })
  const memoised = [1, 2].map((n) => useMemo(() => n + Number(query.data), [query])) // expect: no-unstable-deps
  return memoised
}

// Names resolve to the nearest declaring scope, so dependency arrays in nested functions see the
// component's query result (regression: these used to be missed).
export function NestedFunctionDependencies() {
  const query = useQuery({ queryKey: ['a'], queryFn: () => 'a' })
  function useDerived() {
    return useMemo(() => query.data, [query]) // expect: no-unstable-deps
  }
  const useLogged = () => {
    useEffect(() => {
      console.info(query.status)
    }, [query]) // expect: no-unstable-deps
  }
  return [useDerived, useLogged]
}

// A query declared inside a block, used in the same block (upstream reports it too).
export function DeclaredInBlock(enabled: boolean) {
  if (enabled) {
    const blockQuery = useQuery({ queryKey: ['a'], queryFn: () => 'a' })
    useEffect(() => {}, [blockQuery]) // expect: no-unstable-deps
  }
}

// Wrappers declared inside another function, or as a later declarator of a statement, are
// followed like upstream (regression: these used to be missed).
export function makeTodoHooks() {
  function useInnerTodos() {
    return useQuery({ queryKey: ['inner'], queryFn: () => 'inner' })
  }
  const useInnerMutation = () => useMutation({ mutationFn: (value: string) => value })
  return function TodoList() {
    const todos = useInnerTodos()
    const save = useInnerMutation()
    useEffect(() => {}, [todos, save]) // expect: no-unstable-deps, no-unstable-deps
  }
}

const pageSize = 20,
  usePagedQueries = () => useQueries({ queries: [{ queryKey: ['page', pageSize], queryFn: () => 'page' }] })

export function Paged() {
  const pages = usePagedQueries()
  return useMemo(() => pages.length, [pages, pageSize]) // expect: no-unstable-deps
}

// Class methods are function bodies too (upstream reports these as well).
export class LegacyHookHost {
  render() {
    const query = useQuery({ queryKey: ['a'], queryFn: () => 'a' })
    return useMemo(() => query.data, [query]) // expect: no-unstable-deps
  }
}
