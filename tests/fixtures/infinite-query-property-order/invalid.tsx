import VueQueryPlugin, { infiniteQueryOptions as vueInfiniteQueryOptions } from '@tanstack/vue-query'
import { useInfiniteQuery as useVueInfiniteQuery } from '@tanstack/vue-query'
import { infiniteQueryOptions, useInfiniteQuery, useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { infiniteQueryOptions as angularInfiniteQueryOptions, injectInfiniteQuery } from '@tanstack/angular-query-experimental'

declare const objectExpressionSpread: object
declare const fieldValues: object
declare const myOptions: { infiniteQueryOptions: () => object }
declare const api: { fetchProjects: (page: number) => Promise<Page>; nextCursor: (page: Page) => number }
declare const response: Response
declare function communitiesQuery(options: object): object
declare function makeFetcher(url: string): (context: { pageParam: number }) => Promise<Page>
type Page = { nextId?: number; previousId?: number }

// ---------------------------------------------------------------------------
// Upstream docs example: [getNextPageParam, queryFn, getPreviousPageParam]
// ---------------------------------------------------------------------------

export function DocsExample() {
  return useInfiniteQuery({
    queryKey: ['projects'],
    getNextPageParam: (lastPage) => lastPage.nextId ?? undefined, // expect: infinite-query-property-order
    queryFn: async ({ pageParam }) => {
      const response = await fetch(`/api/projects?cursor=${pageParam}`)
      return await response.json()
    },
    initialPageParam: 0,
    getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
    maxPages: 3,
  })
}

// ---------------------------------------------------------------------------
// Upstream test matrix: the two base invalid permutations for every function
// ---------------------------------------------------------------------------

useInfiniteQuery({
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined, // expect: infinite-query-property-order
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})

useInfiniteQuery({
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined, // expect: infinite-query-property-order
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
})

useSuspenseInfiniteQuery({
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined, // expect: infinite-query-property-order
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})

useSuspenseInfiniteQuery({
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined, // expect: infinite-query-property-order
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
})

infiniteQueryOptions({
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined, // expect: infinite-query-property-order
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})

infiniteQueryOptions({
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined, // expect: infinite-query-property-order
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
})

// ---------------------------------------------------------------------------
// Upstream test matrix: interleaved with order-independent properties
// ---------------------------------------------------------------------------

// queryKey and spreads outside the swapped range: safe fix (the first page param
// and the first queryFn after it trade places).
useInfiniteQuery({
  ...objectExpressionSpread,
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined, // expect: infinite-query-property-order
  queryKey: ['projects'],
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
  ...myOptions.infiniteQueryOptions(),
})

// A spread BETWEEN the swapped properties: reported, but not fixed (moving a
// property across a spread changes which value wins).
useInfiniteQuery({
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined, // expect: infinite-query-property-order
  ...objectExpressionSpread,
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
})

useSuspenseInfiniteQuery({
  queryKey: ['projects'],
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined, // expect: infinite-query-property-order
  ...communitiesQuery({
    filters: {
      ...fieldValues,
      placementFormats: [],
    },
  }),
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})

// A spread after the swapped range does not matter: safe fix.
infiniteQueryOptions({
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined, // expect: infinite-query-property-order
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  ...myOptions.infiniteQueryOptions(),
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
})

// ---------------------------------------------------------------------------
// Other shapes
// ---------------------------------------------------------------------------

// Two checked properties: swapped.
export const projectsQuery = infiniteQueryOptions({
  queryKey: ['projects'],
  initialPageParam: 0,
  getNextPageParam: api.nextCursor, // expect: infinite-query-property-order
  queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
})

// Both page params before queryFn: the first one is swapped with queryFn (the
// relative order of the page params may change; it does not matter).
export function Rotated() {
  const query = useInfiniteQuery<Page>({
    queryKey: ['projects'],
    getPreviousPageParam: (firstPage) => firstPage.previousId, // expect: infinite-query-property-order
    getNextPageParam: (lastPage) => lastPage.nextId,
    initialPageParam: 0,
    queryFn: async function fetchPage({ pageParam }) {
      return api.fetchProjects(pageParam)
    },
  })
  return query.data
}

// Shorthand and method members count, like upstream.
export function Shorthand(getNextPageParam: (page: Page) => number) {
  return useSuspenseInfiniteQuery({
    queryKey: ['projects'],
    initialPageParam: 0,
    getNextPageParam, // expect: infinite-query-property-order
    queryFn({ pageParam }) {
      return api.fetchProjects(pageParam)
    },
  })
}

// Single-line object.
useInfiniteQuery({ queryKey: ['a'], getNextPageParam: (p) => p.nextId, queryFn: () => api.fetchProjects(0), initialPageParam: 0 }) // expect: infinite-query-property-order

// Inside JSX.
export function InJsx() {
  return (
    <ul
      data-query={useInfiniteQuery({
        queryKey: ['jsx'],
        getNextPageParam: (lastPage: Page) => lastPage.nextId, // expect: infinite-query-property-order
        queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
        initialPageParam: 0,
      })}
    />
  )
}

// Additional arguments after the options object (e.g. a QueryClient) do not matter.
declare const queryClient: never
useInfiniteQuery(
  {
    queryKey: ['client'],
    getNextPageParam: (lastPage: Page) => lastPage.nextId, // expect: infinite-query-property-order
    queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
    initialPageParam: 0,
  },
  queryClient,
)

// ---------------------------------------------------------------------------
// Other @tanstack/*-query adapters, aliased imports
// ---------------------------------------------------------------------------

useVueInfiniteQuery({
  queryKey: ['vue'],
  getNextPageParam: (lastPage: Page) => lastPage.nextId, // expect: infinite-query-property-order
  queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
  initialPageParam: 0,
})

export const vueOptions = vueInfiniteQueryOptions({
  getPreviousPageParam: (firstPage: Page) => firstPage.previousId, // expect: infinite-query-property-order
  queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
  getNextPageParam: (lastPage: Page) => lastPage.nextId,
  queryKey: ['vue'],
  initialPageParam: 0,
})
export { VueQueryPlugin }

// ---------------------------------------------------------------------------
// Reported; fixed only when provably behaviour-preserving
// ---------------------------------------------------------------------------

// The value of a moved property could have side effects.
useInfiniteQuery({
  queryKey: ['side-effects'],
  getNextPageParam: (lastPage: Page) => lastPage.nextId, // expect: infinite-query-property-order
  queryFn: makeFetcher('/api/projects'),
  initialPageParam: 0,
})

// Not a plain function/reference (a TS assertion wraps it).
useInfiniteQuery({
  queryKey: ['assertion'],
  getNextPageParam: ((lastPage: Page) => lastPage.nextId) as (page: Page) => number, // expect: infinite-query-property-order
  queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
  initialPageParam: 0,
})

// Duplicated queryFn: fixed in two passes (Biome re-runs fixes until stable).
useInfiniteQuery({
  queryKey: ['duplicate'],
  getNextPageParam: (lastPage: Page) => lastPage.nextId, // expect: infinite-query-property-order
  queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
  // @ts-expect-error duplicate key
  queryFn: ({ pageParam }) => api.fetchProjects(pageParam + 1),
  initialPageParam: 0,
})

// Duplicated page-param key between the swapped properties: which value wins
// would change, so report only.
useInfiniteQuery({
  queryKey: ['duplicate-page-param'],
  getNextPageParam: (lastPage: Page) => lastPage.nextId, // expect: infinite-query-property-order
  // @ts-expect-error duplicate key
  getNextPageParam: (lastPage: Page) => lastPage.nextId ?? 0,
  queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
  initialPageParam: 0,
})

// ---------------------------------------------------------------------------
// Regressions found in review
// ---------------------------------------------------------------------------

// Angular's adapter is published as `@tanstack/angular-query-experimental` (not `*-query`);
// upstream checks its `infiniteQueryOptions` by name, so this port does too.
export const angularQuery = injectInfiniteQuery(() =>
  angularInfiniteQueryOptions({
    queryKey: ['angular'],
    getNextPageParam: (lastPage: Page) => lastPage.nextId, // expect: infinite-query-property-order
    queryFn: ({ pageParam }: { pageParam: number }) => api.fetchProjects(pageParam),
    initialPageParam: 0,
  }),
)

// Optional call: still a CallExpression with an identifier callee (upstream reports it too).
useInfiniteQuery?.({
  queryKey: ['optional-call'],
  getPreviousPageParam: (firstPage: Page) => firstPage.previousId, // expect: infinite-query-property-order
  queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
  initialPageParam: 0,
})

// Accessors and generator methods count as properties and are moved as whole nodes.
useInfiniteQuery({
  queryKey: ['accessors'],
  initialPageParam: 0,
  get getNextPageParam() { // expect: infinite-query-property-order
    return (lastPage: Page) => lastPage.nextId
  },
  async *queryFn() {
    yield await api.fetchProjects(0)
  },
})
