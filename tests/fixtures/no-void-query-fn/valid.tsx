import {
  QueryClient,
  queryOptions,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import type { QueryFunction } from '@tanstack/react-query'
import { useQuery as useVueQuery } from '@tanstack/vue-query'
import { notFound } from 'next/navigation'
import { loadTodos } from './api'

declare function fetchTodos(): Promise<string[]>
declare function report(error: unknown): void
declare function handleError(error: unknown): never
declare const enabled: boolean

// ---------------------------------------------------------------------------
// Ported from the upstream test suite (valid cases)
// ---------------------------------------------------------------------------

// queryFn returns a value
export function Component1() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: () => ({ data: 'test' }),
  })
  return query
}

// queryFn returns a Promise
export function Component2() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: async () => ({ data: 'test' }),
  })
  return query
}

// queryFn returns Promise.resolve
export function Component3() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: () => Promise.resolve({ data: 'test' }),
  })
  return query
}

// queryFn with explicit Promise type
interface Data {
  value: string
}

export function Component4() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: async (): Promise<Data> => {
      return { value: 'test' }
    },
  })
  return query
}

// queryFn with generic Promise type
interface Response<T> {
  data: T
}

export function Component5() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: async (): Promise<Response<string>> => {
      return { data: 'test' }
    },
  })
  return query
}

// queryFn with external async function
async function fetchData(): Promise<{ data: string }> {
  return { data: 'test' }
}

export function Component6() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: fetchData,
  })
  return query
}

// queryFn returns null / 0 / false
export function Component7() {
  const a = useQuery({ queryKey: ['null'], queryFn: () => null })
  const b = useQuery({ queryKey: ['zero'], queryFn: () => 0 })
  const c = useQuery({ queryKey: ['false'], queryFn: () => false })
  return [a, b, c]
}

// useInfiniteQuery / useSuspenseQuery / queryOptions return a value
export function Component8() {
  const infinite = useInfiniteQuery({
    queryKey: ['test'],
    queryFn: ({ pageParam }) => ({ data: 'test', page: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => undefined,
  })
  const suspense = useSuspenseQuery({
    queryKey: ['test'],
    queryFn: () => ({ data: 'test' }),
  })
  return [infinite, suspense]
}

export const options = queryOptions({
  queryKey: ['test'],
  queryFn: () => ({ data: 'test' }),
})

// QueryClient methods return a value
const queryClient = new QueryClient()
queryClient.fetchQuery({
  queryKey: ['test'],
  queryFn: () => fetch('/api/test').then((r) => r.json()),
})
queryClient.prefetchQuery({
  queryKey: ['test'],
  queryFn: () => fetch('/api/test').then((r) => r.json()),
})
queryClient.prefetchInfiniteQuery({
  queryKey: ['test'],
  queryFn: ({ pageParam }: { pageParam: number }) => fetch(`/api/test?page=${pageParam}`).then((r) => r.json()),
  initialPageParam: 0,
})
queryClient.ensureQueryData({
  queryKey: ['test'],
  queryFn: () => fetch('/api/test').then((r) => r.json()),
})
queryClient.ensureInfiniteQueryData({
  queryKey: ['test'],
  queryFn: ({ pageParam }: { pageParam: number }) => fetch(`/api/test?page=${pageParam}`).then((r) => r.json()),
  initialPageParam: 0,
})

// queryFn returns enum members
enum ExampleEnum {
  A,
  B,
}
enum StringEnum {
  Foo = 'foo',
  Bar = 'bar',
}
const enum Direction {
  Up = 'UP',
  Down = 'DOWN',
}

export function Component9() {
  const a = useQuery({ queryKey: ['a'], queryFn: () => ExampleEnum.A })
  const b = useQuery({ queryKey: ['b'], queryFn: () => StringEnum.Foo })
  const c = useQuery({
    queryKey: ['c'],
    queryFn: async () => {
      return ExampleEnum.B
    },
  })
  const d = useQuery({ queryKey: ['d'], queryFn: () => Direction.Up })
  return [a, b, c, d]
}

// ---------------------------------------------------------------------------
// Near misses
// ---------------------------------------------------------------------------

// Every path returns a value.
export function Branches() {
  const ifElse = useQuery({
    queryKey: ['if-else'],
    queryFn: () => {
      if (Math.random() > 0.5) {
        return 'heads'
      } else {
        return 'tails'
      }
    },
  })
  const guard = useQuery({
    queryKey: ['guard'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      if (!response.ok) {
        throw new Error('Request failed')
      }
      return response.json()
    },
  })
  const switchDefault = useQuery({
    queryKey: ['switch'],
    queryFn: () => {
      switch (Math.round(Math.random())) {
        case 0:
          return 'zero'
        default:
          return 'one'
      }
    },
  })
  const loop = useQuery({
    queryKey: ['loop'],
    queryFn: async () => {
      while (true) {
        const response = await fetch('/api/poll')
        if (response.ok) return response.json()
      }
    },
  })
  const rethrow = useQuery({
    queryKey: ['rethrow'],
    queryFn: async () => {
      try {
        return await fetchTodos()
      } catch (error) {
        report(error)
        throw error
      }
    },
  })
  // `handleError` might return `never` (it does here): silent on purpose.
  const neverHelper = useQuery({
    queryKey: ['never-helper'],
    queryFn: async () => {
      try {
        return await fetchTodos()
      } catch (error) {
        handleError(error)
      }
    },
  })
  const finallyBlock = useQuery({
    queryKey: ['finally'],
    queryFn: async () => {
      try {
        return await fetchTodos()
      } finally {
        report('done')
      }
    },
  })
  return [ifElse, guard, switchDefault, loop, rethrow, neverHelper, finallyBlock]
}

// Functions that never complete are typed `never`, not `void`.
export function Diverging() {
  const throws = useQuery({
    queryKey: ['disabled'],
    queryFn: () => {
      throw new Error('This query is disabled')
    },
  })
  const missing = useQuery({
    queryKey: ['not-found'],
    queryFn: async () => {
      notFound()
    },
  })
  return [throws, missing]
}

// `return` statements of nested functions are not the queryFn's.
export function Nested() {
  return useQuery({
    queryKey: ['nested'],
    queryFn: () => {
      const parse = (input: string) => {
        return input.trim()
      }
      return parse(' todo ')
    },
  })
}

// Method shorthand that returns a value.
export const methodOptions = queryOptions({
  queryKey: ['method'],
  queryFn() {
    return fetchTodos()
  },
})

// Values that are not plain functions: conditional with skipToken, type
// assertions and generators are left alone.
export function NotAFunction({ id }: { id?: string }) {
  const conditional = useQuery({
    queryKey: ['todo', id],
    queryFn: id ? () => fetchTodos() : skipToken,
  })
  const toggled = useQuery({
    queryKey: ['toggled'],
    queryFn: enabled ? () => fetchTodos() : skipToken,
  })
  const asserted = useQuery({
    queryKey: ['asserted'],
    queryFn: (() => {}) as unknown as QueryFunction<string[]>,
  })
  return [conditional, toggled, asserted]
}

export const generatorOptions = {
  queryKey: ['generator'],
  queryFn: function* () {
    yield 1
  },
}

// A `queryFn` key that is a string literal is not an identifier key (upstream
// ignores it too).
export const stringKey = {
  'queryFn': () => {},
}

// Mutations may legitimately resolve to void.
export function Mutation() {
  return useMutation({
    mutationFn: async (todo: string) => {
      await fetch('/api/todos', { method: 'POST', body: todo })
    },
  })
}

// References that cannot be resolved safely.
async function voidHelper(): Promise<void> {
  await fetch('/api/ping')
}

let reassignable = async () => {
  await fetch('/api/ping')
}
reassignable = async () => fetchTodos()

export function References(voidHelper: () => Promise<string[]>) {
  // `voidHelper` is the parameter here, not the top-level function.
  const shadowed = useQuery({ queryKey: ['shadowed'], queryFn: voidHelper })
  // `let` bindings can be reassigned.
  const mutable = useQuery({ queryKey: ['let'], queryFn: reassignable })
  // Imported: its body is not visible.
  const imported = useQuery({ queryKey: ['imported'], queryFn: loadTodos })
  return [shadowed, mutable, imported]
}

// Other TanStack Query adapters.
export function VueComponent() {
  return useVueQuery({
    queryKey: ['todos'],
    queryFn: async () => {
      const todos = await fetchTodos()
      return todos
    },
  })
}

// ---------------------------------------------------------------------------
// Regression cases found in review
// ---------------------------------------------------------------------------

// Hoisted helpers after the final `return` do not make the end reachable.
export const hoistedHelper = queryOptions({
  queryKey: ['hoisted'],
  queryFn: async () => {
    return normalize(await fetchTodos())
    function normalize(todos: string[]) {
      return todos.map((todo) => todo.trim())
    }
  },
})

export const hoistedAfterIfElse = queryOptions({
  queryKey: ['hoisted-if-else'],
  queryFn: async ({ signal }) => {
    if (signal.aborted) {
      return []
    } else {
      return parse(await fetchTodos())
    }
    function parse(todos: string[]) {
      return todos
    }
    type Unused = string
  },
})

// Overloads: the type checker uses the FIRST signature, which returns a value.
function loadOverloaded(): Promise<string[]>
function loadOverloaded(id: string): Promise<string[]>
function loadOverloaded(id?: string) {
  console.log(id)
}

// A type annotation on the variable is its type: upstream sees
// `QueryFunction<string[]>`, not the arrow's own return type.
const loadTyped: QueryFunction<string[]> = async ({ signal }) => {
  const response = await fetch('/api/todos', { signal })
  if (!response.ok) return
  return response.json()
}

// Ambient declarations that return a value.
declare const loadDeclared: () => Promise<string[]>

export function Declarations() {
  const overloaded = useQuery({ queryKey: ['overloaded'], queryFn: loadOverloaded })
  const typed = useQuery({ queryKey: ['typed'], queryFn: loadTyped })
  const ambientFunction = useQuery({ queryKey: ['ambient-function'], queryFn: fetchTodos })
  const ambientConst = useQuery({ queryKey: ['ambient-const'], queryFn: loadDeclared })
  return [overloaded, typed, ambientFunction, ambientConst]
}

// More scopes that shadow the void top-level `voidHelper` declared above.
export namespace Scoped {
  function voidHelper() {
    return fetchTodos()
  }
  export const fromNamespace = queryOptions({ queryKey: ['namespace'], queryFn: voidHelper })
}

export function VarShadowing() {
  if (enabled) {
    var voidHelper = () => fetchTodos()
  }
  return useQuery({ queryKey: ['var'], queryFn: voidHelper })
}

export class ScopedClass {
  static options = queryOptions({ queryKey: ['static'], queryFn: () => fetchTodos() })
  static {
    const voidHelper = () => fetchTodos()
    ScopedClass.options = queryOptions({ queryKey: ['static-block'], queryFn: voidHelper })
  }
  set source(voidHelper: () => Promise<string[]>) {
    ScopedClass.options = queryOptions({ queryKey: ['setter'], queryFn: voidHelper })
  }
}

// A custom hook forwarding its own `queryFn` parameter, in a file that also
// has a void top-level `queryFn`.
export const queryFn = async () => {
  await fetch('/api/ping')
}

export function useForwarded(queryFn: () => Promise<string[]>) {
  return useQuery({ queryKey: ['forwarded'], queryFn })
}

// `do...while (true)` and a `do` body that always returns never complete.
export function Loops() {
  const poll = useQuery({
    queryKey: ['poll'],
    queryFn: async () => {
      do {
        const todos = await fetchTodos()
        if (todos.length > 0) return todos
      } while (true)
    },
  })
  const once = useQuery({
    queryKey: ['once'],
    queryFn: async () => {
      do {
        return fetchTodos()
      } while (enabled)
    },
  })
  return [poll, once]
}
