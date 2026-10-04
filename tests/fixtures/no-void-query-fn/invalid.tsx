import { QueryClient, queryOptions, useInfiniteQuery, useQueries, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createQuery } from '@tanstack/solid-query'

declare function someOperation(): Promise<void>
declare function fetchTodos(): Promise<string[]>

// ---------------------------------------------------------------------------
// Ported from the upstream test suite (invalid cases)
// ---------------------------------------------------------------------------

// queryFn returns void
export function Component1() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: () => { // expect: no-void-query-fn
      console.log('test')
    },
  })
  return query
}

// queryFn returns undefined
export function Component2() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: () => undefined, // expect: no-void-query-fn
  })
  return query
}

// async queryFn returns void
export function Component3() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: async () => { // expect: no-void-query-fn
      await someOperation()
    },
  })
  return query
}

// queryFn with explicit void Promise
export function Component4() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: async (): Promise<void> => { // expect: no-void-query-fn
      await someOperation()
    },
  })
  return query
}

// queryFn with Promise.resolve(undefined)
export function Component5() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: () => Promise.resolve(undefined), // expect: no-void-query-fn
  })
  return query
}

// queryFn with external void async function
async function voidOperation(): Promise<void> {
  await someOperation()
}

export function Component6() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: voidOperation, // expect: no-void-query-fn
  })
  return query
}

// queryFn with conditional return (one branch missing)
export function Component7() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: () => { // expect: no-void-query-fn
      if (Math.random() > 0.5) {
        return { data: 'test' }
      }
      // Missing return in the else case
    },
  })
  return query
}

// queryFn with ternary operator returning undefined
export function Component8() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: () => (Math.random() > 0.5 ? { data: 'test' } : undefined), // expect: no-void-query-fn
  })
  return query
}

// async queryFn with try/catch missing return in catch
export function Component9() {
  const query = useQuery({
    queryKey: ['test'],
    queryFn: async () => { // expect: no-void-query-fn
      try {
        return { data: 'test' }
      } catch (error) {
        console.error(error)
        // No return here results in an implicit undefined
      }
    },
  })
  return query
}

// useInfiniteQuery / useSuspenseQuery queryFn returns void
export function Component10() {
  const infinite = useInfiniteQuery({
    queryKey: ['test'],
    queryFn: async ({ pageParam }) => { // expect: no-void-query-fn
      await fetch('/api/test?page=' + pageParam)
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => undefined,
  })
  const suspense = useSuspenseQuery({
    queryKey: ['test'],
    queryFn: () => { // expect: no-void-query-fn
      console.log('fetching')
    },
  })
  return [infinite, suspense]
}

// queryOptions queryFn returns void
export const options = queryOptions({
  queryKey: ['test'],
  queryFn: async () => { // expect: no-void-query-fn
    await fetch('/api/test')
  },
})

// QueryClient methods: queryFn returns void
const queryClient = new QueryClient()
queryClient.fetchQuery({
  queryKey: ['test'],
  queryFn: async () => { // expect: no-void-query-fn
    await fetch('/api/test')
  },
})
queryClient.prefetchQuery({
  queryKey: ['test'],
  queryFn: async () => { // expect: no-void-query-fn
    await fetch('/api/test')
  },
})
queryClient.prefetchInfiniteQuery({
  queryKey: ['test'],
  queryFn: async ({ pageParam }: { pageParam: number }) => { // expect: no-void-query-fn
    await fetch(`/api/test?page=${pageParam}`)
  },
  initialPageParam: 0,
})
queryClient.ensureQueryData({
  queryKey: ['test'],
  queryFn: async () => { // expect: no-void-query-fn
    await fetch('/api/test')
  },
})
queryClient.ensureInfiniteQueryData({
  queryKey: ['test'],
  queryFn: async ({ pageParam }: { pageParam: number }) => { // expect: no-void-query-fn
    await fetch(`/api/test?page=${pageParam}`)
  },
  initialPageParam: 0,
})

// ---------------------------------------------------------------------------
// Additional cases
// ---------------------------------------------------------------------------

// Bodies that forget to return on some path.
export function Paths() {
  const bareReturn = useQuery({
    queryKey: ['bare'],
    queryFn: async () => { // expect: no-void-query-fn
      const response = await fetch('/api/todos')
      if (!response.ok) return
      return response.json()
    },
  })
  const undefinedReturn = useQuery({
    queryKey: ['undefined'],
    queryFn: async () => { // expect: no-void-query-fn
      const todos = await fetchTodos()
      if (todos.length === 0) {
        return undefined
      }
      return todos
    },
  })
  const switchWithoutDefault = useQuery({
    queryKey: ['switch'],
    queryFn: () => { // expect: no-void-query-fn
      switch (Math.round(Math.random())) {
        case 0:
          return 'zero'
        case 1:
          return 'one'
      }
    },
  })
  const loop = useQuery({
    queryKey: ['loop'],
    queryFn: async () => { // expect: no-void-query-fn
      for (const todo of await fetchTodos()) {
        if (todo.startsWith('!')) return todo
      }
    },
  })
  const empty = useQuery({ queryKey: ['empty'], queryFn: () => {} }) // expect: no-void-query-fn
  return [bareReturn, undefinedReturn, switchWithoutDefault, loop, empty]
}

// Expressions that evaluate to undefined/void.
export function Expressions() {
  const voidOperator = useQuery({ queryKey: ['void'], queryFn: () => void someOperation() }) // expect: no-void-query-fn
  const resolved = useQuery({ queryKey: ['resolve'], queryFn: () => Promise.resolve() }) // expect: no-void-query-fn
  const forgottenReturn = useQuery({
    queryKey: ['then'],
    queryFn: () => // expect: no-void-query-fn
      fetch('/api/todos').then((response) => {
        response.json()
      }),
  })
  return [voidOperator, resolved, forgottenReturn]
}

// Explicit return types that include undefined.
export const annotated = queryOptions({
  queryKey: ['annotated'],
  queryFn: async (): Promise<string[] | undefined> => fetchTodos(), // expect: no-void-query-fn
})

// `function` expressions and method shorthand.
export const functionExpression = queryOptions({
  queryKey: ['function'],
  queryFn: async function loadAll() { // expect: no-void-query-fn
    await fetchTodos()
  },
})

export const method = queryOptions({
  queryKey: ['method'],
  async queryFn() { // expect: no-void-query-fn
    await fetchTodos()
  },
})

// References to void top-level functions, including `{ queryFn }` shorthand.
const queryFn = async () => {
  await fetch('/api/todos')
}

export function logTodos() {
  console.log('todos')
}

export function References() {
  const shorthand = useQuery({ queryKey: ['shorthand'], queryFn }) // expect: no-void-query-fn
  const exported = useQueries({
    queries: [{ queryKey: ['exported'], queryFn: logTodos }], // expect: no-void-query-fn
  })
  return [shorthand, exported]
}

// Other TanStack Query adapters.
export function SolidComponent() {
  return createQuery(() => ({
    queryKey: ['todos'],
    queryFn: async () => { // expect: no-void-query-fn
      await fetchTodos()
    },
  }))
}

// ---------------------------------------------------------------------------
// Regression cases found in review
// ---------------------------------------------------------------------------

// Ambient declarations, overloads and annotated variables: the declared type
// decides.
declare function refreshAll(): Promise<void>
export declare function refreshOne(id: string): Promise<void>
declare const refreshLater: () => Promise<void>

function loadOverloaded(): Promise<void>
function loadOverloaded(id: string): Promise<string>
function loadOverloaded(id?: string): Promise<string | void> {
  return Promise.resolve(id)
}

const loadTyped: () => Promise<void> = async () => {
  await fetchTodos()
}

export function Declarations() {
  const ambient = useQuery({ queryKey: ['ambient'], queryFn: someOperation }) // expect: no-void-query-fn
  const all = useQuery({ queryKey: ['all'], queryFn: refreshAll }) // expect: no-void-query-fn
  const one = useQuery({ queryKey: ['one'], queryFn: refreshOne }) // expect: no-void-query-fn
  const later = useQuery({ queryKey: ['later'], queryFn: refreshLater }) // expect: no-void-query-fn
  const overloaded = useQuery({ queryKey: ['overloaded'], queryFn: loadOverloaded }) // expect: no-void-query-fn
  const typed = useQuery({ queryKey: ['typed'], queryFn: loadTyped }) // expect: no-void-query-fn
  return [ambient, all, one, later, overloaded, typed]
}

// A missing return is still found when hoisted helpers follow it.
export const hoisted = queryOptions({
  queryKey: ['hoisted'],
  queryFn: async () => { // expect: no-void-query-fn
    const todos = await fetchTodos()
    if (todos.length > 0) return normalize(todos)
    function normalize(list: string[]) {
      return list.map((todo) => todo.trim())
    }
  },
})

// Labeled loops and `do...while` can complete normally.
export function Loops() {
  const labeled = useQuery({
    queryKey: ['labeled'],
    queryFn: async () => { // expect: no-void-query-fn
      outer: for (const todo of await fetchTodos()) {
        for (const tag of todo.split(' ')) {
          if (tag === '!') break outer
        }
      }
    },
  })
  const doWhile = useQuery({
    queryKey: ['do-while'],
    queryFn: async () => { // expect: no-void-query-fn
      let page = 0
      do {
        const todos = await fetchTodos()
        if (todos.length > 0) return todos
        page++
      } while (page < 3)
    },
  })
  return [labeled, doWhile]
}

// No `queryKey` next to the `queryFn`: the TanStack Query import is enough.
const baseOptions = { queryKey: ['base'] }
export function Spread() {
  return useQuery({
    ...baseOptions,
    queryFn: async () => { // expect: no-void-query-fn
      await fetchTodos()
    },
  })
}
