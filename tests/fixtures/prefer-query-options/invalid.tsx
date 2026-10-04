import {
  QueryClient,
  QueryClient as Client,
  useInfiniteQuery,
  useIsFetching,
  usePrefetchInfiniteQuery,
  usePrefetchQuery,
  useQueries,
  useQuery,
  useQuery as useTanstackQuery,
  useQueryClient,
  useQueryClient as getClient,
  useSuspenseInfiniteQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useQuery as useVueQuery } from '@tanstack/vue-query'
import { useQueries as useSolidQueries } from '@tanstack/solid-query'

declare const options: { queryKey: string[] }
declare function fetchTodos(page?: unknown): Promise<string[]>
declare function fetchTodo(id: unknown): Promise<string>
declare function fetchUsers(): Promise<string[]>
declare function fetchOverride(): Promise<string[]>

// ---------------------------------------------------------------------------
// Upstream: inline lone queryKey or queryFn in hooks
// ---------------------------------------------------------------------------

export function LoneQueryKey() {
  const query = useQuery({ queryKey: ['todos'] }) // expect: prefer-query-options
  return query
}

export function LoneQueryFn() {
  const query = useQuery({ queryFn: () => fetchTodos() }) // expect: prefer-query-options
  return query
}

// ---------------------------------------------------------------------------
// Upstream: spread with inline queryKey or queryFn override in hooks
// ---------------------------------------------------------------------------

export function SpreadOverrideKey() {
  const query = useQuery({ ...options, queryKey: ['override'] }) // expect: prefer-query-options
  return query
}

export function SpreadOverrideFn() {
  const query = useQuery({ ...options, queryFn: () => fetchOverride() }) // expect: prefer-query-options
  return query
}

// ---------------------------------------------------------------------------
// Upstream: inline queryKey + queryFn in hooks
// ---------------------------------------------------------------------------

export function InlineUseQuery() {
  const query = useQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
  return query
}

export function AliasedUseQuery() {
  const query = useTanstackQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
  return query
}

export function InlineUseInfiniteQuery() {
  const query = useInfiniteQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: ({ pageParam }) => fetchTodos(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage: { nextCursor: number }) => lastPage.nextCursor,
  })
  return query
}

export function InlineUseSuspenseQuery() {
  const query = useSuspenseQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
  return query
}

export function InlineUseSuspenseInfiniteQuery() {
  const query = useSuspenseInfiniteQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: ({ pageParam }) => fetchTodos(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage: { nextCursor: number }) => lastPage.nextCursor,
  })
  return query
}

export function InlineUseQueries() {
  const queries = useQueries({
    queries: [
      {
        queryKey: ['todos'], // expect: prefer-query-options
        queryFn: () => fetchTodos(),
      },
    ],
  })
  return queries
}

export function InlineUseQueriesMultiple() {
  const queries = useQueries({
    queries: [
      {
        queryKey: ['todos'], // expect: prefer-query-options
        queryFn: () => fetchTodos(),
      },
      {
        queryKey: ['users'], // expect: prefer-query-options
        queryFn: () => fetchUsers(),
      },
    ],
  })
  return queries
}

export function MappedUseQueries({ ids }: { ids: number[] }) {
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['todos', id], // expect: prefer-query-options
      queryFn: () => fetchTodo(id),
    })),
  })
  return queries
}

export function InlineUseSuspenseQueries() {
  const queries = useSuspenseQueries({
    queries: [
      {
        queryKey: ['todos'], // expect: prefer-query-options
        queryFn: () => fetchTodos(),
      },
    ],
  })
  return queries
}

export function MappedUseSuspenseQueries({ ids }: { ids: number[] }) {
  const queries = useSuspenseQueries({
    queries: ids.map((id) => ({
      queryKey: ['todos', id], // expect: prefer-query-options
      queryFn: () => fetchTodo(id),
    })),
  })
  return queries
}

export function InlineUsePrefetchQuery() {
  usePrefetchQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
  return null
}

export function InlineUsePrefetchInfiniteQuery() {
  usePrefetchInfiniteQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: ({ pageParam }) => fetchTodos(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage: { nextCursor: number }) => lastPage.nextCursor,
  })
  return null
}

export function useTodos() {
  return useQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
}

// ---------------------------------------------------------------------------
// Upstream: queryClient with alternate variable names
// ---------------------------------------------------------------------------

export function ClientFetchQuery() {
  const client = useQueryClient()
  client.fetchQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
  return null
}

export function AliasedUseQueryClient() {
  const client = getClient()
  client.fetchQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
  return null
}

const aliasedQueryClient = new Client()

aliasedQueryClient.fetchQuery({ // expect: prefer-query-options
  queryKey: ['todos'],
  queryFn: () => fetchTodos(),
})

export function QcGetQueryData() {
  const qc = useQueryClient()
  const data = qc.getQueryData(['todos']) // expect: prefer-query-options
  return data
}

export function ClientInvalidateQueries() {
  const client = useQueryClient()
  client.invalidateQueries({ queryKey: ['todos'] }) // expect: prefer-query-options
  return null
}

// ---------------------------------------------------------------------------
// Upstream: inline queryKey + queryFn in queryClient methods
// ---------------------------------------------------------------------------

export function FetchQuery() {
  const queryClient = useQueryClient()
  queryClient.fetchQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
  return null
}

export function PrefetchQuery() {
  const queryClient = useQueryClient()
  queryClient.prefetchQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
  return null
}

export function FetchInfiniteQuery() {
  const queryClient = useQueryClient()
  queryClient.fetchInfiniteQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: ({ pageParam }) => fetchTodos(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage: { nextCursor: number }) => lastPage.nextCursor,
  })
  return null
}

export function PrefetchInfiniteQuery() {
  const queryClient = useQueryClient()
  queryClient.prefetchInfiniteQuery({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: ({ pageParam }) => fetchTodos(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage: { nextCursor: number }) => lastPage.nextCursor,
  })
  return null
}

export function EnsureQueryData() {
  const queryClient = useQueryClient()
  queryClient.ensureQueryData({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
  return null
}

export function EnsureInfiniteQueryData() {
  const queryClient = useQueryClient()
  queryClient.ensureInfiniteQueryData({ // expect: prefer-query-options
    queryKey: ['todos'],
    queryFn: ({ pageParam }) => fetchTodos(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage: { nextCursor: number }) => lastPage.nextCursor,
  })
  return null
}

// ---------------------------------------------------------------------------
// Upstream: inline queryKey as direct parameter
// ---------------------------------------------------------------------------

export function GetQueryData() {
  const queryClient = useQueryClient()
  const data = queryClient.getQueryData(['todos']) // expect: prefer-query-options
  return data
}

export function GetQueryDataAsConst() {
  const queryClient = useQueryClient()
  const data = queryClient.getQueryData(['todos'] as const) // expect: prefer-query-options
  return data
}

export function GetQueryDataSatisfies() {
  const queryClient = useQueryClient()
  const data = queryClient.getQueryData((['todos']) satisfies readonly string[]) // expect: prefer-query-options
  return data
}

export function SetQueryData() {
  const queryClient = useQueryClient()
  queryClient.setQueryData(['todos'], []) // expect: prefer-query-options
  return null
}

export function GetQueryState() {
  const queryClient = useQueryClient()
  const state = queryClient.getQueryState(['todos']) // expect: prefer-query-options
  return state
}

export function SetQueryDefaults() {
  const queryClient = useQueryClient()
  queryClient.setQueryDefaults(['todos'], { staleTime: 1000 }) // expect: prefer-query-options
  return null
}

export function GetQueryDefaults() {
  const queryClient = useQueryClient()
  const defaults = queryClient.getQueryDefaults(['todos']) // expect: prefer-query-options
  return defaults
}

// ---------------------------------------------------------------------------
// Upstream: inline queryKey in filter objects
// ---------------------------------------------------------------------------

export function InvalidateQueries() {
  const queryClient = useQueryClient()
  queryClient.invalidateQueries({ queryKey: ['todos'] }) // expect: prefer-query-options
  return null
}

export function InvalidateQueriesAsConst() {
  const queryClient = useQueryClient()
  queryClient.invalidateQueries({ queryKey: ['todos'] as const }) // expect: prefer-query-options
  return null
}

export function InvalidateQueriesSatisfies() {
  const queryClient = useQueryClient()
  queryClient.invalidateQueries({
    queryKey: (['todos']) satisfies readonly string[], // expect: prefer-query-options
  })
  return null
}

export function CancelQueries() {
  const queryClient = useQueryClient()
  queryClient.cancelQueries({ queryKey: ['todos'] }) // expect: prefer-query-options
  return null
}

export function RefetchQueries() {
  const queryClient = useQueryClient()
  queryClient.refetchQueries({ queryKey: ['todos'] }) // expect: prefer-query-options
  return null
}

export function RemoveQueries() {
  const queryClient = useQueryClient()
  queryClient.removeQueries({ queryKey: ['todos'] }) // expect: prefer-query-options
  return null
}

export function ResetQueries() {
  const queryClient = useQueryClient()
  queryClient.resetQueries({ queryKey: ['todos'] }) // expect: prefer-query-options
  return null
}

export function IsFetching() {
  const queryClient = useQueryClient()
  const count = queryClient.isFetching({ queryKey: ['todos'] }) // expect: prefer-query-options
  return count
}

export function GetQueriesData() {
  const queryClient = useQueryClient()
  const data = queryClient.getQueriesData({ queryKey: ['todos'] }) // expect: prefer-query-options
  return data
}

export function SetQueriesData() {
  const queryClient = useQueryClient()
  queryClient.setQueriesData({ queryKey: ['todos'] }, []) // expect: prefer-query-options
  return null
}

export function UseIsFetching() {
  const count = useIsFetching({ queryKey: ['todos'] }) // expect: prefer-query-options
  return count
}

// ---------------------------------------------------------------------------
// Additional cases (same semantics as upstream, Biome-specific syntax shapes)
// ---------------------------------------------------------------------------

// Parentheses are transparent (ESTree has no parenthesized nodes).
export function ParenthesizedOptions() {
  useQuery(({ queryKey: ['todos'] })) // expect: prefer-query-options
  const queryClient = useQueryClient()
  queryClient.getQueryData((['todos'])) // expect: prefer-query-options
  return null
}

// Shorthand and method members are ESTree `Property` nodes too.
export function ShorthandAndMethodMembers({ queryKey }: { queryKey: string[] }) {
  useQuery({ queryKey, queryFn: fetchTodos }) // expect: prefer-query-options
  useQuery({ // expect: prefer-query-options
    ...options,
    queryFn() {
      return fetchTodos()
    },
  }).data
  return useSuspenseQueries({
    queries: [{ queryKey, queryFn: fetchTodos }], // expect: prefer-query-options
  })
}

// Other framework adapters (@tanstack/<framework>-query).
export function OtherAdapters({ ids }: { ids: number[] }) {
  useVueQuery({ queryKey: ['todos'], queryFn: fetchTodos }) // expect: prefer-query-options
  return useSolidQueries({
    queries: ids.map((id) => ({ queryKey: ['todo', id], queryFn: () => fetchTodo(id) })), // expect: prefer-query-options
  })
}

// Every result branch of a mapper is inspected (upstream getReturnedObjectExpressions).
// (A named function expression, so Biome's useArrowFunction does not rewrite it.)
export function ConditionalMapper({ ids }: { ids: number[] }) {
  return useQueries({
    queries: ids.map(function toQuery(id) {
      return id > 0
        ? { queryKey: ['todo', id], queryFn: () => fetchTodo(id) } // expect: prefer-query-options
        : { queryFn: () => fetchTodos() } // expect: prefer-query-options
    }),
  })
}

export function NestedBranches({ ids }: { ids: number[] }) {
  return useQueries({
    queries: ids.map((id) =>
      id > 1
        ? id > 2
          ? { queryKey: ['a', id], queryFn: () => fetchTodo(id) } // expect: prefer-query-options
          : { queryKey: ['b', id], queryFn: () => fetchTodo(id) } // expect: prefer-query-options
        : id === 0 && { queryFn: () => fetchTodos() }, // expect: prefer-query-options
    ),
  })
}

// Optional calls, type assertions and inline clients.
export function ClientShapes() {
  const queryClient = useQueryClient()
  queryClient?.fetchQuery({ queryKey: ['todos'], queryFn: fetchTodos }) // expect: prefer-query-options
  ;(queryClient as QueryClient).prefetchQuery({ queryKey: ['todos'], queryFn: fetchTodos }) // expect: prefer-query-options
  useQueryClient().invalidateQueries({ queryKey: ['todos'] }) // expect: prefer-query-options
  new QueryClient().getQueryData(['todos']) // expect: prefer-query-options
  return null
}

// A module-level, exported client is resolved inside nested functions.
export const sharedQueryClient = new QueryClient()

export async function loader() {
  await sharedQueryClient.ensureQueryData({ queryKey: ['todos'], queryFn: fetchTodos }) // expect: prefer-query-options
  if (Math.random() > 0.5) {
    sharedQueryClient.removeQueries({ exact: true, queryKey: ['todos'] }) // expect: prefer-query-options
  }
}

// ---------------------------------------------------------------------------
// Regressions found in review
// ---------------------------------------------------------------------------

// Span ownership in useQueries entries: exhaustive-deps owns a shorthand
// `queryKey` (its queryKey value) and no-void-query-fn owns a shorthand
// `queryFn`, so an entry is reported on its `queryKey: ...` member, else its
// inline `queryFn` member, else a shorthand `queryKey`, else the entry itself.
declare const queryFn: () => Promise<string[]>
export function EntryAnchors({ id }: { id: number }) {
  const queryKey = ['todo', id]
  return useQueries({
    queries: [
      { queryFn }, // expect: prefer-query-options
      { queryKey, queryFn: () => fetchTodo(id) }, // expect: prefer-query-options
      { queryKey, queryFn }, // expect: prefer-query-options
      {
        queryKey,
        queryFn() { // expect: prefer-query-options
          return fetchTodo(id)
        },
      },
    ],
  })
}

// A parenthesized receiver ends an optional chain, so upstream inspects it;
// a parenthesized `queries` value is inspected too.
declare const maybeIds: { ids: number[] } | undefined
export function ParenthesizedQueries() {
  useQueries({
    queries: (maybeIds?.ids ?? []).map((id) => ({ queryKey: ['todo', id] })), // expect: prefer-query-options
  })
  return useQueries({ queries: ([{ queryKey: ['todos'] }]) }) // expect: prefer-query-options
}

// `let` / `var` clients and explicit type arguments.
// (A lower-case name, so stable-query-client does not treat it as a component.)
export function clientDeclarations() {
  let letClient = useQueryClient()
  var varClient = new QueryClient()
  letClient.fetchQuery({ queryKey: ['todos'] }) // expect: prefer-query-options
  varClient.setQueryData<string[]>(['todos'], []) // expect: prefer-query-options
  letClient = varClient
  return useQuery<string[]>({ queryKey: ['todos'] }) // expect: prefer-query-options
}
