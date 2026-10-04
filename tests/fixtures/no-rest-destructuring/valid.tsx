import type { UseQueryResult } from '@tanstack/react-query'
import * as TanstackQuery from '@tanstack/react-query'
import {
  useInfiniteQuery,
  useInfiniteQuery as useInfinite,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useQueries } from '@tanstack/vue-query'
import { useQuery } from '@acme/react-query'
import { useSuspenseInfiniteQuery } from '@tanstack/react-query-devtools'
// Type-only import written without a space (regression: used to count as a value import)
import type{ useSuspenseQueries } from '@tanstack/react-query'

declare const props: { a: number; b: number }

// ---------------------------------------------------------------------------
// Ported from upstream: no-rest-destructuring.test.ts (valid)
// ---------------------------------------------------------------------------

// useInfiniteQuery / useSuspenseQuery are not captured
export function NotCaptured() {
  useInfiniteQuery()
  useSuspenseQuery()
  useQueries([])
  return
}

// ... are not destructured
export function NotDestructured() {
  const query = useInfiniteQuery()
  const suspenseQuery = useSuspenseQuery()
  const queries = useQueries([])
  return [query, suspenseQuery, queries]
}

// ... are destructured without rest
export function DestructuredWithoutRest() {
  const { data, isLoading, isError } = useInfiniteQuery()
  const { data: other, status } = useSuspenseQuery()
  return [data, isLoading, isError, other, status]
}

// useQueries array has no rest destructured element (holes and array rest are fine)
export function QueriesWithoutRest() {
  const [query1, { data, isLoading },, ...others] = useQueries([
    { queryKey: ['key1'], queryFn: () => {} },
    { queryKey: ['key2'], queryFn: () => {} },
    { queryKey: ['key3'], queryFn: () => {} },
    { queryKey: ['key4'], queryFn: () => {} },
    { queryKey: ['key5'], queryFn: () => {} },
  ])
  return [query1, data, isLoading, others]
}

// useQuery is destructured with rest but not from tanstack query (upstream
// uses 'other-package'; '@acme/react-query' also checks the `@tanstack/` prefix)
export function UseQueryFromOtherPackage() {
  const { data, ...rest } = useQuery()
  const query = useQuery()
  return [data, rest, { ...query }]
}

// useSuspenseInfiniteQuery comes from a @tanstack package that is not a
// `*-query` adapter
export function UseSuspenseInfiniteQueryFromOtherPackage() {
  const { data, ...rest } = useSuspenseInfiniteQuery()
  return [data, rest]
}

// useSuspenseQueries is only imported as a type
export function UseSuspenseQueriesTypeOnlyImport() {
  const [query1, { data, ...rest }] = useSuspenseQueries([
    { queryKey: ['key1'], queryFn: () => {} },
    { queryKey: ['key2'], queryFn: () => {} },
  ])
  return [query1, data, rest]
}

// From the upstream documentation: normal object destructuring is fine
export function DocsExample() {
  const todosQuery = useSuspenseQuery({ queryKey: ['todos'] })
  const { data: todos } = todosQuery
  return todos
}

// ---------------------------------------------------------------------------
// Near misses
// ---------------------------------------------------------------------------

// A rest element in a NESTED pattern spreads the nested value, not the query
export function NestedRest() {
  const {
    data: { first, ...otherFields },
  } = useSuspenseQuery()
  const [{ data: { id, ...item } }] = useQueries({ queries: [] })
  return [first, otherFields, id, item]
}

// useQueries element with a default value, and nested array patterns
// (upstream only inspects direct object-pattern elements)
export function QueriesDefaultsAndNesting() {
  const [{ data, ...rest } = {}, [{ status, ...nested }]] = useQueries({ queries: [] })
  return [data, rest, status, nested]
}

// `combine` turns the useQueries result into an arbitrary object
export function QueriesCombine() {
  const { data, ...rest } = useQueries({
    queries: [],
    combine: (results) => ({ data: results.map((result) => result.data), pending: false }),
  })
  return [data, rest]
}

// Spreading the ARRAY returned by useQueries does not read any property of
// the query results (upstream reports this, see docs/rules/no-rest-destructuring.md)
export function QueriesArraySpread() {
  const queries = useQueries({ queries: [] })
  return [...queries]
}

// Spreading or rest-destructuring a FIELD of the result is fine
export function FieldSpread() {
  const query = useSuspenseQuery()
  const { first, ...others } = query.data
  return { ...query.data, first, others }
}

// Other hooks from @tanstack/react-query
export function OtherHooks() {
  const { invalidateQueries, ...client } = useQueryClient()
  return { ...client, invalidateQueries }
}

// Ordinary rest/spread usage in components
export function Props() {
  const { a, ...others } = props
  const merged = { ...props, ...others }
  return [a, merged]
}

// A name that holds a query result in ANOTHER function
export function Owner() {
  const query = useSuspenseQuery()
  return query.data
}

export function Unrelated(query: { a: number }) {
  const { a, ...others } = query
  return { ...query, a, others }
}

// Closures, blocks and loops that rebind the name
export function Shadowing(list: Array<{ a: number }>) {
  const query = useInfiniteQuery()
  const mapped = list.map((query) => ({ ...query }))
  const callback = function () {
    const query = { a: 1 }
    return { ...query }
  }
  for (const query of list) {
    console.log({ ...query })
  }
  if (mapped) {
    const query = list[0]
    const { a, ...others } = query
    return [a, others, callback]
  }
  try {
    return query.data
  } catch (query) {
    return { ...query }
  }
}

// A query result declared inside a nested function is not visible outside it
export function NestedDeclaration() {
  function useInner() {
    const result = useSuspenseQuery()
    return result.data
  }
  const result = { a: 1 }
  return [useInner, { ...result }]
}

// Assignment (not declaration) destructuring: not reported upstream either
export function AssignmentDestructuring() {
  let data: unknown
  let rest: unknown
  ;({ data, ...rest } = useSuspenseQuery())
  return [data, rest]
}

// ---------------------------------------------------------------------------
// Regression cases from the adversarial review
// ---------------------------------------------------------------------------

// A rest element in a callback PARAMETER belongs to the callback, even though
// the hook's declarator encloses it
export function RestInCallbackParameter() {
  const { data } = useSuspenseQuery({
    queryKey: ['select'],
    select: ({ a, ...others }: { a: number; b: number }) => others,
  })
  const [first] = useQueries({
    queries: [],
    combine: ([{ data: value, ...others }]) => [value, others],
  })
  return [data, first]
}

// `case` clauses share one scope without braces, so this `query` is not the
// query result
export function SwitchShadowing(kind: number) {
  const query = useSuspenseQuery()
  switch (kind) {
    case 1:
      const query = { a: 1 }
      return { ...query }
    default:
      return query.data
  }
}

// Class static blocks are scopes too
export function StaticBlockShadowing() {
  const query = useSuspenseQuery()
  class Store {
    static {
      const query = { a: 1 }
      console.log({ ...query })
    }
  }
  return [Store, query.data]
}

// The nearest declaration of a name wins: the closure's own `query` holds
// another value
export function NearestDeclarationWins() {
  const query = useInfiniteQuery()
  const callback = () => {
    const query = structuredClone({ a: 1 })
    return { ...query }
  }
  return [query.data, callback]
}

// A local binding of the hook's name hides the import (stricter than
// upstream, which compares names only)
export function LocalHookShadowing() {
  const useSuspenseQuery = () => ({ data: 1, extra: 2 })
  const { data, ...rest } = useSuspenseQuery()
  return [data, rest]
}

export function HookAsParameter(useInfiniteQuery: () => { data: number }) {
  const result = useInfiniteQuery()
  return { ...result }
}

export function NestedHookDeclaration() {
  function useSuspenseQuery() {
    return { data: 1 }
  }
  const { data, ...rest } = useSuspenseQuery()
  return [data, rest]
}

// ---------------------------------------------------------------------------
// Known false negatives (kept here so a future improvement shows up in review)
// ---------------------------------------------------------------------------

// Aliased imports and namespace imports: also not reported upstream
export function AliasedAndNamespaced() {
  const { data, ...rest } = useInfinite()
  const { data: other, ...others } = TanstackQuery.useSuspenseQuery()
  return [data, rest, other, others]
}

// Wrapped calls: also not reported upstream
export function Wrapped() {
  const { data, ...rest } = useSuspenseQuery() as UseQueryResult<string>
  return [data, rest]
}

// Custom hooks returning a query result: upstream needs typed linting for
// these, which GritQL does not have
const useTodos = () => useSuspenseQuery({ queryKey: ['todos'] })

export function CustomHook() {
  const { data, ...rest } = useTodos()
  const todosQuery = useTodos()
  return [data, rest, { ...todosQuery }]
}

// JSX spread attributes are not object spreads: also not reported upstream
export function JsxSpread() {
  const query = useSuspenseQuery()
  return <div {...query} />
}
