import {
  QueryClient,
  infiniteQueryOptions,
  queryOptions,
  useIsFetching,
  useQueries,
  useQuery,
  useQueryClient,
  useSuspenseQueries,
} from '@tanstack/react-query'
import type { QueryClient as QueryClientType, UseQueryOptions } from '@tanstack/react-query'
import { QueryClient as CoreQueryClient } from '@tanstack/query-core'
import { useSuspenseQuery, useQueryClient as useOtherClient } from 'other-library'
import { getFooOptions } from './foo'
import * as RQ from '@tanstack/react-query'
import { createQuery } from '@tanstack/svelte-query'
import { injectQuery } from '@tanstack/angular-query-experimental'
// A re-export creates no local binding: `useInfiniteQuery` below is the local declaration.
export { useInfiniteQuery } from '@tanstack/react-query'
declare function useInfiniteQuery(options: object): unknown
const { useQuery: requiredUseQuery } = require('@tanstack/react-query')

declare function fetchTodos(page?: unknown): Promise<string[]>
declare function fetchTodo(id: unknown): Promise<string>
declare const usersOptions: ReturnType<typeof queryOptions>
declare const options: UseQueryOptions

// ---------------------------------------------------------------------------
// Upstream: queryOptions / infiniteQueryOptions builders are allowed
// ---------------------------------------------------------------------------

const todosOptions = queryOptions({
  queryKey: ['todos'],
  queryFn: () => fetchTodos(),
})

export const infiniteTodosOptions = infiniteQueryOptions({
  queryKey: ['todos'],
  queryFn: ({ pageParam }) => fetchTodos(pageParam),
  initialPageParam: 0,
  getNextPageParam: (lastPage: { nextCursor: number }) => lastPage.nextCursor,
})

function todoOptions(id: number) {
  return queryOptions({
    queryKey: ['todo', id],
    queryFn: () => fetchTodo(id),
  })
}

// ---------------------------------------------------------------------------
// Upstream: hooks consuming a queryOptions result
// ---------------------------------------------------------------------------

export function WithOptions() {
  return useQuery(todosOptions)
}

export function WithOptionsCall({ id }: { id: number }) {
  return useQuery(todoOptions(id))
}

export function WithImportedOptionsCall({ id }: { id: number }) {
  return useQuery(getFooOptions(id))
}

export function SpreadOptions() {
  return useQuery({ ...todosOptions, select: (data) => data.length })
}

export function SpreadOptionsCall({ id }: { id: number }) {
  return useQuery({ ...todoOptions(id), select: (data) => data.length })
}

export function QueriesFromOptions() {
  return useQueries({
    queries: [todosOptions, usersOptions],
  })
}

// ---------------------------------------------------------------------------
// Upstream: queryClient methods referencing queryKey from options
// ---------------------------------------------------------------------------

export function GetQueryDataFromOptions() {
  const queryClient = useQueryClient()
  return queryClient.getQueryData(todosOptions.queryKey)
}

export function SetQueryDataFromOptions() {
  const queryClient = useQueryClient()
  queryClient.setQueryData(todosOptions.queryKey, [])
  return null
}

export function InvalidateFromOptions() {
  const queryClient = useQueryClient()
  queryClient.invalidateQueries({ queryKey: todosOptions.queryKey })
  queryClient.invalidateQueries({ queryKey: todosOptions.queryKey, exact: true })
  return null
}

export function GetQueryDataWithVariable({ queryKey }: { queryKey: string[] }) {
  const queryClient = useQueryClient()
  return queryClient.getQueryData(queryKey)
}

// Upstream: a parameter shadowing the query client is ignored.
export function ShadowedQueryClientParameter() {
  const queryClient = useQueryClient()

  function run(queryClient: { fetchQuery: (options: object) => void }) {
    queryClient.fetchQuery({
      queryKey: ['todos'],
      queryFn: () => fetchTodos(),
    })
  }

  return [queryClient, run]
}

// Upstream: a fetchQuery method on something that is not a QueryClient.
const analytics = {
  fetchQuery(options: object) {
    return options
  },
}

export function NotAQueryClient() {
  useQuery(todosOptions)
  analytics.fetchQuery({
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
  return null
}

// Upstream: `useQuery` imported from another library. (This file already
// imports useQuery from TanStack, so another hook name stands in for it.)
export function NonTanstackHook() {
  return useSuspenseQuery({
    queryKey: ['todos'],
    queryFn: () => fetchTodos(),
  })
}

// ---------------------------------------------------------------------------
// Near misses
// ---------------------------------------------------------------------------

// A local binding shadowing the imported hook / filter hook.
export function ShadowedHookParameter({ useQuery }: { useQuery: (options: object) => unknown }) {
  return useQuery({ queryKey: ['todos'], queryFn: fetchTodos })
}

export function ShadowedHookDeclaration() {
  const useIsFetching = (filters: object) => filters
  if (Math.random() > 0.5) {
    function useQueries(options: object) {
      return options
    }
    useQueries({ queries: [{ queryKey: ['todos'], queryFn: fetchTodos }] })
  }
  return useIsFetching({ queryKey: ['todos'] })
}

// Loop variables shadow imports and clients too.
export function ShadowedByLoopVariables(hooks: Array<(options: object) => void>, clients: Array<typeof analytics>) {
  const queryClient = useQueryClient()
  for (const useQuery of hooks) useQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  for (const queryClient of clients) {
    queryClient.fetchQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  }
  return queryClient
}

// A local variable with the same name as an outer QueryClient variable.
const moduleClient = new QueryClient()

export function ShadowedClientVariable(getClient: () => typeof analytics) {
  const moduleClient = getClient()
  moduleClient.fetchQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  return null
}

// A QueryClient variable declared in a sibling scope is not in scope here.
export function SiblingScopeA() {
  const siblingClient = useQueryClient()
  return siblingClient.getQueryData(todosOptions.queryKey)
}

declare const siblingClient: typeof analytics

export function SiblingScopeB() {
  return siblingClient.fetchQuery({ queryKey: ['todos'], queryFn: fetchTodos })
}

// Clients from other packages: @tanstack/query-core does not end in
// "-query", so upstream ignores it too; other libraries are ignored.
export function OtherClients() {
  const coreClient = new CoreQueryClient()
  coreClient.fetchQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  const otherClient = useOtherClient()
  otherClient.invalidateQueries({ queryKey: ['todos'] })
  return null
}

// A type-only import cannot create a client.
declare const TypedClient: new () => typeof analytics
export function TypeOnlyImport(client: QueryClientType) {
  const typed = new TypedClient()
  typed.fetchQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  return client
}

// A non-null assertion is not unwrapped by upstream either.
export function NonNullClient() {
  const queryClient = useQueryClient()
  queryClient!.fetchQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  return null
}

// Shapes upstream does not consider inline options.
export function NotInlineOptions({ queryKey, ids }: { queryKey: string[]; ids?: number[] }) {
  const queryClient = useQueryClient()
  // A type assertion around the options object (not an ObjectExpression).
  useQuery({ queryKey, queryFn: fetchTodos } as UseQueryOptions)
  // Quoted keys are not identifier keys.
  useQuery({ 'queryKey': ['todos'], 'queryFn': fetchTodos })
  // No options argument at all, or options in a later argument.
  useQuery(options)
  // Filters without an inline array queryKey.
  queryClient.invalidateQueries({ queryKey })
  queryClient.invalidateQueries({ queryKey: [...todosOptions.queryKey, 'extra'].slice(0, 1) })
  queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'todos' })
  queryClient.removeQueries()
  useIsFetching({ queryKey: todosOptions.queryKey })
  useIsFetching()
  // An inline key in a non-key argument position.
  queryClient.setQueryData(todosOptions.queryKey, ['todos'])
  // A key method with a non-array argument.
  queryClient.getQueryData(queryKey)
  // fetchQuery with an options object built elsewhere.
  queryClient.fetchQuery({ ...todosOptions, staleTime: 1000 })
  // Methods that are not in upstream's lists.
  queryClient.setQueryData(todosOptions.queryKey, { queryKey: ['todos'] })
  queryClient.getMutationCache().find({ mutationKey: ['todos'] })
  // `queries` shorthand / optional chain / non-returned objects are not
  // followed by upstream.
  const queries = [{ queryKey: ['todos'], queryFn: fetchTodos }]
  useSuspenseQueries({ queries })
  useQueries({ queries: ids?.map((id) => ({ queryKey: ['todo', id], queryFn: () => fetchTodo(id) })) ?? [] })
  useQueries({
    queries: (ids ?? []).map((id) => {
      if (id > 0) {
        return { queryKey: ['todo', id], queryFn: () => fetchTodo(id) }
      }
      return todoOptions(id)
    }),
  })
  // Objects inside an entry are not entries themselves.
  useQueries({ queries: [{ ...todosOptions, meta: { queryKey: ['todos'] } }] })
  return null
}

// ---------------------------------------------------------------------------
// Regressions found in review
// ---------------------------------------------------------------------------

// Callees upstream does not resolve: namespace members, CommonJS, re-exports,
// and adapters outside upstream's hook lists or not named `*-query`.
export function UnresolvedCallees() {
  RQ.useQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  requiredUseQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  useInfiniteQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  createQuery(() => ({ queryKey: ['todos'], queryFn: fetchTodos }))
  injectQuery(() => ({ queryKey: ['todos'], queryFn: fetchTodos }))
  return null
}

// Receivers upstream does not resolve: `this.client`, computed method names.
export class ClassComponent {
  client = new QueryClient()
  load() {
    this.client.fetchQuery({ queryKey: ['todos'], queryFn: fetchTodos })
    const queryClient = this.client
    queryClient['fetchQuery']({ queryKey: ['todos'], queryFn: fetchTodos })
  }
}

// Scopes that shadow an import or a client: all clauses of a `switch` share
// one scope; class static blocks; TS namespaces; setter parameters; the name
// of a named function / class expression; `var` hoisted out of a block.
const staticClient = new QueryClient()

export function ShadowedBySwitch(kind: number) {
  switch (kind) {
    case 1:
      const useQuery = (options: object) => options
      return useQuery
    default:
      return useQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  }
}

export class StaticBlock {
  static {
    const staticClient = { getQueryData: (key: unknown) => key }
    staticClient.getQueryData(['todos'])
  }
}

namespace Legacy {
  const staticClient = { getQueryData: (key: unknown) => key }
  staticClient.getQueryData(['todos'])
  export const useQuery = (options: object) => options
  useQuery({ queryKey: ['todos'] })
}

export const settable = {
  set client(staticClient: { getQueryData: (key: unknown) => unknown }) {
    staticClient.getQueryData(['todos'])
  },
}

export const NamedExpression = function useQuery(): unknown {
  return useQuery({ queryKey: ['todos'] })
}

export const NamedClass = class useIsFetching {
  run() {
    return new useIsFetching()
  }
}

export function HoistedVar(enabled: boolean) {
  if (enabled) {
    var useQueries = (options: object) => options
  }
  return useQueries({ queries: [{ queryKey: ['todos'], queryFn: fetchTodos }] })
}

// Optional chains end at parentheses; anything inside one is skipped, as upstream.
declare const maybe: { ids: number[]; list(): number[] } | undefined
export function OptionalChains() {
  useQueries({ queries: maybe?.ids.map((id) => ({ queryKey: ['todo', id] })) ?? [] })
  useQueries({ queries: maybe?.list().map((id) => ({ queryKey: ['todo', id] })) ?? [] })
  // Neither branch of a conditional `queries` value is inspected by upstream.
  useQueries({ queries: maybe ? [{ queryKey: ['todo'] }] : [] })
  return [Legacy, staticClient]
}
