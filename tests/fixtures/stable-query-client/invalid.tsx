import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import * as React from 'react'

declare const children: React.ReactNode
declare const enabled: boolean

export const TodosContext = React.createContext<string[]>([])

// --- Ported from the upstream test suite -------------------------------------------------------

// QueryClient is not stable when it is not wrapped in React.useState in a component
function Component() {
  const queryClient = new QueryClient() // expect: stable-query-client
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// ... in a custom hook
function useHook() {
  const queryClient = new QueryClient() // expect: stable-query-client
  return queryClient
}

// preserve QueryClient options
function WithOptions() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 1000 } } }) // expect: stable-query-client
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// preserve QueryClient variable declarator name
function CustomName() {
  const customName = new QueryClient() // expect: stable-query-client
  return <QueryClientProvider client={customName}>{children}</QueryClientProvider>
}

// destructuring pattern (upstream reports it without a fix; this port never fixes)
function Destructured() {
  const { getQueryCache } = new QueryClient() // expect: stable-query-client
  return getQueryCache()
}

// --- Additional cases ----------------------------------------------------------------------------

// Exported components, `export default function`, and named function expressions.
export function ExportedApp() {
  const queryClient = new QueryClient() // expect: stable-query-client
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

export default function DefaultApp() {
  const queryClient = new QueryClient() // expect: stable-query-client
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

export const NamedExpression = function NamedExpression() {
  const queryClient = new QueryClient() // expect: stable-query-client
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// `use` alone is a valid hook name too.
function use() {
  const queryClient = new QueryClient() // expect: stable-query-client
  return queryClient
}

// `new QueryClient` without an argument list, and a parenthesized initializer.
function NoArguments() {
  const queryClient = new QueryClient // expect: stable-query-client
  const parenthesized = (new QueryClient()) // expect: stable-query-client
  return [queryClient, parenthesized]
}

// `let` / `var`, several declarators in one statement, and a type annotation on the binding.
function useDeclarationKinds() {
  let first = new QueryClient(), second: QueryClient = new QueryClient() // expect: stable-query-client, stable-query-client
  var third = new QueryClient() // expect: stable-query-client
  first = second
  return [first, third]
}

// Multi-line options: the diagnostic starts on the `new` line.
function MultiLine() {
  const queryClient = new QueryClient({ // expect: stable-query-client
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// Still created on every render when nested in a block of the component.
function Conditional() {
  if (enabled) {
    const queryClient = new QueryClient() // expect: stable-query-client
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return null
}

// Generators are not async, so they are not exempt (same as upstream).
function* GeneratorComponent() {
  const queryClient = new QueryClient() // expect: stable-query-client
  yield queryClient
}

// Components passed to a HOC, and named function expressions in object literals: upstream's
// outermost function is the named function expression itself, so these are reported too.
export const Memoized = React.memo(function Memoized() {
  const queryClient = new QueryClient() // expect: stable-query-client
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
})
export const stories = {
  render: function Render() {
    const queryClient = new QueryClient() // expect: stable-query-client
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  },
}

// `QueryClient` mentioned again without being re-bound (type annotations, an object key in a
// destructuring that binds another name): still the imported class.
function TypedClient(props: { fallback?: QueryClient }) {
  const { QueryClient: Renamed } = { QueryClient: props.fallback }
  const queryClient: QueryClient = new QueryClient() // expect: stable-query-client
  return [queryClient, Renamed]
}

// Components declared inside a namespace or a class static block are not nested in a function.
namespace Screens {
  export function Screen() {
    const queryClient = new QueryClient() // expect: stable-query-client
    return queryClient
  }
}
export class Registry {
  static {
    function RegisteredScreen() {
      const queryClient = new QueryClient() // expect: stable-query-client
      return queryClient
    }
    Registry.screen = RegisteredScreen
  }
  static screen: unknown
}

export function useTodos() {
  return useQuery({ queryKey: ['todos'], queryFn: () => [] })
}

export { Component, Conditional, CustomName, Screens, TypedClient, Destructured, GeneratorComponent, MultiLine, NoArguments, WithOptions, use, useDeclarationKinds, useHook }
