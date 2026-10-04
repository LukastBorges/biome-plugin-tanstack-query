import { createInfiniteQuery } from '@tanstack/svelte-query'
import { useInfiniteQuery as useSolidInfiniteQuery } from '@tanstack/solid-query'
import { injectInfiniteQuery, infiniteQueryOptions as angularInfiniteQueryOptions } from '@tanstack/angular-query-experimental'
import { infiniteQueryOptions as vueInfiniteQueryOptions } from '@tanstack/vue-query'
import { infiniteQueryOptions, useInfiniteQuery, useQuery, useSuspenseInfiniteQuery } from '@tanstack/react-query'
import * as ReactQuery from '@tanstack/react-query'
import { useInfiniteQuery as useOtherInfiniteQuery } from 'some-other-data-library'
import { infiniteQueryOptions as coreInfiniteQueryOptions } from '@tanstack/query-core'
import { useInfiniteQuery as useDevtoolsThing } from '@tanstack/react-query-devtools'
import type { useSuspenseInfiniteQuery as useTypeOnly } from '@tanstack/react-query'
import { type useInfiniteQuery as useInlineTypeOnly } from '@tanstack/react-query'
// Names that merely start or end like a target function (not real exports, kept as regressions).
import { useSuspenseInfiniteQueryX as notATarget, xinfiniteQueryOptions as alsoNotATarget } from '@tanstack/react-query'
import { useInfiniteQuery as useFeed } from '@tanstack/react-query'
import { useInfiniteQuery as useFeedLocal } from './local-query'

declare const objectExpressionSpread: object
declare const fieldValues: object
declare const response: Response
declare const api: { fetchProjects: (page: number) => Promise<Page>; nextCursor: (page: Page) => number }
declare function communitiesQuery(options: object): object
declare function getNextPageParam(page: Page): number
type Page = { nextId?: number; previousId?: number }

// ---------------------------------------------------------------------------
// Upstream valid matrix: every function x every correct partial order
// ---------------------------------------------------------------------------

useInfiniteQuery({
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
})
useInfiniteQuery({
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})
useInfiniteQuery({
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})
useInfiniteQuery({
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})

useSuspenseInfiniteQuery({
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
})
useSuspenseInfiniteQuery({
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})
useSuspenseInfiniteQuery({
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})
useSuspenseInfiniteQuery({
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})

infiniteQueryOptions({
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
})
infiniteQueryOptions({
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})
infiniteQueryOptions({
  queryFn: async ({ pageParam }) => {
    await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})
infiniteQueryOptions({
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
})

// ---------------------------------------------------------------------------
// Upstream regression test: call expression spread
// ---------------------------------------------------------------------------

export function Communities() {
  const { data, isFetching, isLoading, hasNextPage, fetchNextPage } = useInfiniteQuery({
    ...communitiesQuery({
      filters: {
        ...fieldValues,
        placementFormats: [],
      },
    }),
    refetchOnMount: false,
  })
  return { data, isFetching, isLoading, hasNextPage, fetchNextPage }
}

// ---------------------------------------------------------------------------
// Correct order, any placement of order-insensitive properties
// ---------------------------------------------------------------------------

// The upstream docs example (correct version).
useInfiniteQuery({
  queryKey: ['projects'],
  queryFn: async ({ pageParam }) => {
    const response = await fetch(`/api/projects?cursor=${pageParam}`)
    return await response.json()
  },
  initialPageParam: 0,
  getPreviousPageParam: (firstPage) => firstPage.previousId ?? undefined,
  getNextPageParam: (lastPage) => lastPage.nextId ?? undefined,
  maxPages: 3,
})

// getNextPageParam before getPreviousPageParam is fine: only queryFn must come first.
useInfiniteQuery({
  ...objectExpressionSpread,
  queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
  ...objectExpressionSpread,
  getNextPageParam: (lastPage) => lastPage.nextId,
  queryKey: ['projects'],
  getPreviousPageParam: (firstPage) => firstPage.previousId,
  initialPageParam: 0,
})

// Only one of the checked properties, or none at all.
useInfiniteQuery({ queryKey: ['a'], getNextPageParam, initialPageParam: 0 })
useInfiniteQuery({ queryKey: ['a'], queryFn: () => api.fetchProjects(0) })
useInfiniteQuery({})
useInfiniteQuery()

// ---------------------------------------------------------------------------
// Near misses that must not be reported
// ---------------------------------------------------------------------------

// Order matters only for the inference-sensitive infinite query functions.
useQuery({ getNextPageParam, queryFn: () => api.fetchProjects(0), queryKey: ['not-infinite'] } as never)

// Nested objects are not the options object.
useInfiniteQuery({
  queryKey: ['nested'],
  queryFn: () => api.fetchProjects(0),
  getNextPageParam,
  meta: { getNextPageParam: 'meta', queryFn: 'meta' },
})

// Only the first argument is the options object.
useInfiniteQuery(
  { queryKey: ['args'], queryFn: () => api.fetchProjects(0), getNextPageParam, initialPageParam: 0 },
  { getNextPageParam: 1, queryFn: 2 } as never,
)

// String-literal and computed keys are not identifier keys (upstream ignores the former too).
useInfiniteQuery({
  queryKey: ['string-keys'],
  'getNextPageParam': getNextPageParam,
  queryFn: () => api.fetchProjects(0),
  initialPageParam: 0,
})

// Not an object literal.
declare const options: Parameters<typeof useInfiniteQuery>[0]
useInfiniteQuery(options)
useInfiniteQuery({ ...options })

// Member calls are not checked (same as upstream, which requires an identifier callee).
ReactQuery.useInfiniteQuery({
  queryKey: ['namespace'],
  getNextPageParam,
  queryFn: () => api.fetchProjects(0),
  initialPageParam: 0,
})

// Same-named functions imported from other libraries, or from TanStack packages
// that are not `@tanstack/*-query` adapters.
useOtherInfiniteQuery({ getNextPageParam, queryFn: () => api.fetchProjects(0) })
coreInfiniteQueryOptions({ getNextPageParam, queryFn: () => api.fetchProjects(0) })
useDevtoolsThing({ getNextPageParam, queryFn: () => api.fetchProjects(0) })

// Type-only imports cannot be called at runtime.
useTypeOnly({ getNextPageParam, queryFn: () => api.fetchProjects(0) })
useInlineTypeOnly({ getNextPageParam, queryFn: () => api.fetchProjects(0) })

// Other adapters: correct order, or option getters/other entry points upstream does not check.
vueInfiniteQueryOptions({
  queryKey: ['vue'],
  queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
  getNextPageParam: (lastPage: Page) => lastPage.nextId,
  initialPageParam: 0,
})
useSolidInfiniteQuery(() => ({
  queryKey: ['solid'],
  getNextPageParam: (lastPage: Page) => lastPage.nextId,
  queryFn: ({ pageParam }: { pageParam: number }) => api.fetchProjects(pageParam),
  initialPageParam: 0,
}))
createInfiniteQuery({
  queryKey: ['svelte'],
  getNextPageParam: (lastPage: Page) => lastPage.nextId,
  queryFn: ({ pageParam }: { pageParam: number }) => api.fetchProjects(pageParam),
  initialPageParam: 0,
})
injectInfiniteQuery(() => ({
  queryKey: ['angular'],
  getNextPageParam: (lastPage: Page) => lastPage.nextId,
  queryFn: ({ pageParam }: { pageParam: number }) => api.fetchProjects(pageParam),
  initialPageParam: 0,
}))

// ---------------------------------------------------------------------------
// Suppression (the generic form works both standalone and in the presets)
// ---------------------------------------------------------------------------

useInfiniteQuery({
  queryKey: ['suppressed'],
  // biome-ignore lint/plugin: fixture for the suppression comment
  getNextPageParam: (lastPage: Page) => lastPage.nextId,
  queryFn: ({ pageParam }) => api.fetchProjects(pageParam),
  initialPageParam: 0,
})

// ---------------------------------------------------------------------------
// Regressions found in review
// ---------------------------------------------------------------------------

// The imported name must be exactly one of the targets: an unanchored regex alternation used to
// accept `useSuspenseInfiniteQueryX` and `xinfiniteQueryOptions`.
notATarget({ getNextPageParam, queryFn: () => api.fetchProjects(0) })
alsoNotATarget({ getNextPageParam, queryFn: () => api.fetchProjects(0) })

// The callee must be exactly the local alias: `useFeedLocal` comes from a local module, even though
// `useFeed` (a prefix of it) is a TanStack alias.
useFeedLocal({ getNextPageParam, queryFn: () => api.fetchProjects(0) })
useFeed({ queryKey: ['feed'], queryFn: ({ pageParam }) => api.fetchProjects(pageParam), getNextPageParam, initialPageParam: 0 })

// Angular adapter (@tanstack/angular-query-experimental), correct order.
injectInfiniteQuery(() =>
  angularInfiniteQueryOptions({
    queryKey: ['angular-options'],
    queryFn: ({ pageParam }: { pageParam: number }) => api.fetchProjects(pageParam),
    getNextPageParam: (lastPage: Page) => lastPage.nextId,
    initialPageParam: 0,
  }),
)
