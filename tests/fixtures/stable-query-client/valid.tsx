// QueryClient IS imported from @tanstack/react-query here, so the rule is armed: everything below
// must stay silent for structural reasons. (Files that import QueryClient from another package,
// e.g. @tanstack/solid-query, are never reported at all; see docs/rules/stable-query-client.md.)
import * as RQ from '@tanstack/react-query'
import {
  QueryClient,
  QueryClient as TanstackClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

declare function describe(name: string, fn: () => void): void
declare function useAnything<T>(init: () => T): [T]
declare const children: React.ReactNode
declare let globalClient: QueryClient

// --- Ported from the upstream test suite -------------------------------------------------------

// QueryClient is stable when wrapped in React.useState
function Component1() {
  const [queryClient] = React.useState(() => new QueryClient())
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// QueryClient is stable when wrapped in useState
function Component2() {
  const [queryClient] = useState(() => new QueryClient())
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// QueryClient is stable when wrapped in React.useMemo
function Component3() {
  const queryClient = React.useMemo(() => new QueryClient(), [])
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// QueryClient is stable when wrapped in useAnything
function Component4() {
  const [queryClient] = useAnything(() => new QueryClient())
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// QueryClient is created outside of a function
const moduleClient = new QueryClient()
export function App() {
  return <QueryClientProvider client={moduleClient}>{children}</QueryClientProvider>
}

// QueryClient is created in a non-component function
function someFn() {
  const queryClient = new QueryClient()
  return queryClient
}

// QueryClient is not flagged in an async (server) component
async function ServerComponent() {
  const queryClient = new QueryClient()
  await queryClient.prefetchQuery({ queryKey: ['todos'], queryFn: () => [] })
  return null
}
export default async function Page() {
  const queryClient = new QueryClient()
  await queryClient.prefetchQuery({ queryKey: ['todos'], queryFn: () => [] })
  return null
}
const AsyncExpression = async function AsyncExpression() {
  const queryClient = new QueryClient()
  return queryClient
}

// --- Not a component or hook: no `id` (upstream `isValidReactComponentOrHookName`) ---------------

// Arrow functions have no `id` upstream either, so arrow components are never reported.
const ArrowComponent = () => {
  const queryClient = new QueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// Class and object methods.
class LegacyProvider extends React.Component {
  render() {
    const queryClient = new QueryClient()
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}
const factories = {
  Create() {
    const queryClient = new QueryClient()
    return queryClient
  },
}

// Names that do not follow the component / hook convention.
function createQueryClient() {
  const queryClient = new QueryClient()
  return queryClient
}
function user() {
  const queryClient = new QueryClient()
  return queryClient
}
function _Component() {
  const queryClient = new QueryClient()
  return queryClient
}

// A component nested in a non-component function: upstream looks at the OUTERMOST function only.
// (Typical test wrappers.)
function createWrapper() {
  return function Wrapper() {
    const queryClient = new QueryClient()
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}
describe('wrapper', () => {
  function Wrapper() {
    const queryClient = new QueryClient()
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
})

// --- Created inside a nested function of the component: not once per render ---------------------
// (Upstream reports these because it only inspects the outermost function; this port does not.)

function LazyInitializer() {
  const [queryClient] = useState(() => {
    const client = new QueryClient()
    client.setQueryDefaults(['todos'], { staleTime: 1000 })
    return client
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function EffectComponent() {
  const ref = useRef<QueryClient | null>(null)
  useEffect(() => {
    const client = new QueryClient()
    ref.current = client
    return () => client.clear()
  }, [])
  return null
}

function useMemoBlock() {
  return useMemo(() => {
    const client = new QueryClient()
    return client
  }, [])
}

function HandlerComponent() {
  function reset() {
    const client = new QueryClient()
    globalClient = client
  }
  const onClick = function onClick() {
    const client = new QueryClient()
    globalClient = client
  }
  return (
    <button type="button" onClick={reset} onDoubleClick={onClick}>
      reset
    </button>
  )
}

function ClassInsideComponent() {
  class Holder {
    client = new QueryClient()
    make() {
      const client = new QueryClient()
      return client
    }
  }
  return new Holder()
}

// --- Not a `const x = new QueryClient()` declaration (upstream requires a VariableDeclarator parent)

function NotADeclarator() {
  let client: QueryClient
  client = new QueryClient()
  const casted = new QueryClient() as QueryClient
  const conditional = globalClient ? globalClient : new QueryClient()
  const ref = useRef(new QueryClient())
  return <QueryClientProvider client={client ?? casted ?? conditional ?? ref.current}>{children}</QueryClientProvider>
}

// --- Not the imported `QueryClient` identifier ---------------------------------------------------

function NamespaceImport() {
  // Upstream only looks at a bare `QueryClient` callee.
  const queryClient = new RQ.QueryClient()
  return queryClient
}

function AliasedImport() {
  // The local name is not `QueryClient` (upstream compares the callee's name).
  const queryClient = new TanstackClient()
  return queryClient
}

function OtherClasses() {
  const a = new QueryClientProvider({ client: globalClient, children })
  const b = new MyQueryClient()
  const c = new QueryCache()
  return [a, b, c]
}
declare class MyQueryClient {}
declare class QueryCache {}

// --- A local binding shadows the imported QueryClient -------------------------------------------
// (Upstream reports these: it has no scope check. Any `QueryClient` binding inside the component
// silences the rule for that component.)

declare class LocalClient {}
function ShadowedByParam({ QueryClient }: { QueryClient: typeof LocalClient }) {
  const client = new QueryClient()
  return client
}
function useShadowedByPlainParam(QueryClient: typeof LocalClient) {
  const client = new QueryClient()
  return client
}
function ShadowedByVariable() {
  const QueryClient = LocalClient
  const client = new QueryClient()
  return client
}
function ShadowedByClass() {
  class QueryClient {}
  const client = new QueryClient()
  return client
}

// Async exports (server components) in every position.
export async function AsyncExported() {
  const queryClient = new QueryClient()
  return queryClient
}
export const AsyncInHoc = React.memo(async function AsyncInHoc() {
  const queryClient = new QueryClient()
  return queryClient
})

// Wrapped initializers (upstream requires the `new` expression to be the declarator's direct child).
function WrappedInitializers() {
  const nonNull = new QueryClient()!
  const checked = new QueryClient() satisfies QueryClient
  return [nonNull, checked]
}

export function useTodos() {
  return useQuery({ queryKey: ['todos'], queryFn: () => [] })
}

export {
  AliasedImport,
  ShadowedByClass,
  ShadowedByParam,
  ShadowedByVariable,
  WrappedInitializers,
  useShadowedByPlainParam,
  ArrowComponent,
  AsyncExpression,
  ClassInsideComponent,
  Component1,
  Component2,
  Component3,
  Component4,
  EffectComponent,
  HandlerComponent,
  LazyInitializer,
  LegacyProvider,
  NamespaceImport,
  NotADeclarator,
  OtherClasses,
  ServerComponent,
  _Component,
  createQueryClient,
  createWrapper,
  factories,
  someFn,
  useMemoBlock,
  user,
}
