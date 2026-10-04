// Cases ported from the upstream test suite (packages/eslint-plugin-query/src/__tests__/exhaustive-deps.test.ts
// at @tanstack/eslint-plugin-query@5.104.1) plus our own. The diagnostic is reported on the queryKey
// value, so every `expect:` annotation sits on the line where that value starts.
import { createQuery } from '@tanstack/solid-query'
import {
  queryOptions,
  skipToken,
  useInfiniteQuery,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import axios from 'axios'
import React from 'react'

declare const api: any
declare function fetchEntity(...args: Array<unknown>): Promise<unknown>
declare function fetchEntities(): Promise<unknown>
declare function fetchA(...args: Array<unknown>): Promise<unknown>
declare function fetchB(...args: Array<unknown>): Promise<unknown>

// upstream: should fail when a computed method name is missing in queryKey
export function ComputedMethod({ client, operation }) {
  useQuery({
    queryKey: ['data'], // expect: exhaustive-deps
    queryFn: () => client[operation](),
  })
}

// upstream: should fail when deps are missing in query factory
export const todoQueries = {
  list: () => ({ queryKey: ['entity'], queryFn: fetchEntities }),
  detail: (id) => ({ queryKey: ['entity'], queryFn: () => fetchEntity(id) }), // expect: exhaustive-deps
}

// upstream: should fail when no deps are passed (react)
export function NoDepsReact() {
  const id = 1
  useQuery({ queryKey: ['entity'], queryFn: () => api.getEntity(id) }) // expect: exhaustive-deps
}

// upstream: should fail when no deps are passed (solid)
export function NoDepsSolid() {
  const id = 1
  createQuery(() => ({ queryKey: ['entity'], queryFn: () => api.getEntity(id) })) // expect: exhaustive-deps
}

// upstream: should fail when deps are passed incorrectly (a plain string is not a template literal)
export function PassedIncorrectly() {
  const id = 1
  useQuery({ queryKey: ['entity/${id}'], queryFn: () => api.getEntity(id) }) // expect: exhaustive-deps
}

// upstream: should pass missing dep while key has a template literal
export function TemplateLiteralMissingOne() {
  const a = 1
  const b = 2
  useQuery({ queryKey: [`entity/${a}`], queryFn: () => api.getEntity(a, b) }) // expect: exhaustive-deps
}

// upstream: should fail when dep exists inside setter and missing in queryKey
export function FromUseState() {
  const [id] = React.useState(1)
  useQuery({
    queryKey: ['entity'], // expect: exhaustive-deps
    queryFn: () => {
      const { data } = axios.get(`.../${id}`)
      return data
    },
  })
}

// upstream: should fail when dep does not exist while having a complex queryKey (missing: d, e)
export const complexQueries = {
  key: (a, b, c, d, e) => ({
    queryKey: ['entity', a, [b], { c }, 1, true], // expect: exhaustive-deps
    queryFn: () => api.getEntity(a, b, c, d, e),
  }),
}

// upstream: should fail when dep does not exist while having a complex queryKey #2 (missing: dep8)
export const complexQueries2 = {
  key: (dep1, dep2, dep3, dep4, dep5, dep6, dep7, dep8) => ({
    queryKey: ['foo', { dep1, dep2: dep2, bar: dep3, baz: [dep4, dep5] }, [dep6, dep7]], // expect: exhaustive-deps
    queryFn: () => api.getEntity(dep1, dep2, dep3, dep4, dep5, dep6, dep7, dep8),
  }),
}

// upstream: should fail when two deps that depend on each other are missing
// (upstream lists `map[key]`; this port lists the roots: `map, key`)
export function DependentDeps({ map, key }) {
  useQuery({ queryKey: ['key'], queryFn: () => api.get(map[key]) }) // expect: exhaustive-deps
}

// upstream: should fail when a queryKey is a reference of an array expression with a missing dep
export function ShorthandKeyReference() {
  const x = 5
  const queryKey = ['foo']
  useQuery({ queryKey, queryFn: () => x }) // expect: exhaustive-deps
}

// upstream: should fail when queryKey is a queryKeyFactory while having missing dep
const fooQueryKeyFactory = { foo: () => ['foo'] as const }

export const useFoo = (num: number) =>
  useQuery({
    queryKey: fooQueryKeyFactory.foo(), // expect: exhaustive-deps
    queryFn: () => Promise.resolve(num),
  })

// upstream: should fail when queryKey is a chained queryKeyFactory while having missing dep in earlier call
const chainedFactory = {
  foo: (num: number) => ({
    detail: (flag: boolean) => ['foo', num, flag] as const,
  }),
}

export const useChained = (num: number, flag: boolean) =>
  useQuery({
    queryKey: chainedFactory.foo(1).detail(flag), // expect: exhaustive-deps
    queryFn: () => Promise.resolve({ num, flag }),
  })

// upstream: should fail if queryFn is invalid while using FunctionExpression (method) syntax
export function MethodSyntax() {
  const id = 1
  useQuery({
    queryKey: [], // expect: exhaustive-deps
    queryFn() {
      return Promise.resolve(id)
    },
  })
}

// upstream: should fail if queryFn is a ternary expression with missing dep and a skipToken
const enabled = true
export function TernarySkipToken({ id }) {
  useQuery({
    queryKey: [], // expect: exhaustive-deps
    queryFn: enabled ? () => Promise.resolve(id) : skipToken,
  })
}

// upstream (Vue variant, ported to a hook): should fail when multiple deps are missing
export function useUser() {
  const userId = 1
  const orgId = 2
  return useQuery({
    queryKey: ['users'], // expect: exhaustive-deps
    queryFn: () => fetchEntity(userId, orgId),
  })
}

// upstream: should fail when dep used in then/catch is missing in queryKey
export function ThenCatch() {
  const id = 1
  useQuery({
    queryKey: ['foo'], // expect: exhaustive-deps
    queryFn: () =>
      Promise.resolve(null)
        .then(() => id)
        .catch(() => id),
  })
}

// upstream: should fail when queryKey callback only references a shadowing local
export function ShadowedInKeyCallback(id, ids) {
  useQuery({
    queryKey: ['thing', ids.map((id) => id)], // expect: exhaustive-deps
    queryFn: () => id,
  })
}

// upstream: should fail when dep used in try/catch/finally is missing in queryKey
export function TryCatchFinally() {
  const id = 1
  useQuery({
    queryKey: ['foo'], // expect: exhaustive-deps
    queryFn: () => {
      try {
        return fetch(id)
      } catch (error) {
        console.error(error)
        return id
      } finally {
        console.log('done')
      }
    },
  })
}

// upstream: should fail when queryKey has TSAsExpression with missing dep
export function useAsConst(dep) {
  return useQuery({
    queryKey: ['thing'] as const, // expect: exhaustive-deps
    queryFn: () => dep,
  })
}

// upstream: should fail when queryKey references identifier with missing dep
export function useKeyIdentifier(dep) {
  const key = ['thing']
  return useQuery({
    queryKey: key, // expect: exhaustive-deps
    queryFn: () => dep,
  })
}

// upstream: should fail when type allowlist is empty (upstream lists `api.baseUrl`; we list `api`)
interface Api {
  baseUrl: string
}
export function useTypedParam(api: Api) {
  return useQuery({
    queryKey: ['thing'], // expect: exhaustive-deps
    queryFn: () => api.baseUrl,
  })
}

// upstream: should fix correctly when queryKey has trailing comma
export function useTrailingComma(dep) {
  return useQuery({
    queryKey: ['thing',], // expect: exhaustive-deps
    queryFn: () => dep,
  })
}

// upstream: should fix correctly when queryKey is empty with whitespace
export function useEmptyWithWhitespace(dep) {
  return useQuery({
    queryKey: [ ], // expect: exhaustive-deps
    queryFn: () => dep,
  })
}

// upstream: should fail when dep in alternate branch of ternary queryFn is missing
export function useAlternate(condition, a, b) {
  return useQuery({
    queryKey: ['thing', a], // expect: exhaustive-deps
    queryFn: condition ? () => fetchA(a) : () => fetchB(b),
  })
}

// upstream: should fail when dep in consequent branch of ternary queryFn is missing
export function useConsequent(condition, a, b) {
  return useQuery({
    queryKey: ['thing', b], // expect: exhaustive-deps
    queryFn: condition ? () => fetchA(a) : () => fetchB(b),
  })
}

// upstream (allowlist suite, without options): should fail when missing member path not in allowlist.variables
export function useMemberPath(svc, id) {
  return useQuery({
    queryKey: ['thing', id], // expect: exhaustive-deps
    queryFn: () => {
      return { part: svc.part, id }
    },
  })
}

// upstream (allowlist suite, without options): both roots are reported
export function useTwoRoots(svc, other) {
  return useQuery({
    queryKey: ['thing'], // expect: exhaustive-deps
    queryFn: () => {
      return { svcPart: svc.part, otherX: other.x }
    },
  })
}

// upstream (allowlist suite): should not inherit allowlisted type from outer shadowed binding
interface AllowedService {
  baseUrl: string
}
interface OtherService {
  baseUrl: string
}
export function useShadowedBinding() {
  const svc: AllowedService = { baseUrl: 'allowed' }
  if (Math.random()) {
    const svc: OtherService = { baseUrl: 'other' }
    return useQuery({
      queryKey: ['thing'], // expect: exhaustive-deps
      queryFn: () => {
        return svc.baseUrl
      },
    })
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Our own cases
// ---------------------------------------------------------------------------------------------

// queryOptions() factories, multi-line keys, other query hooks.
export function todoOptions(todoId: string, locale: string) {
  return queryOptions({
    queryKey: [ // expect: exhaustive-deps
      'todo',
      todoId,
    ],
    queryFn: () => api.getTodo(todoId, { locale }),
  })
}

export function useTodoSuspense(todoId: string) {
  return useSuspenseQuery({ queryKey: ['todo'], queryFn: async () => api.getTodo(todoId) }) // expect: exhaustive-deps
}

// queryFn parameters (pageParam, signal, ...) are never dependencies, but the outer `filter` is.
export function useInfiniteTodos(filter: string) {
  return useInfiniteQuery({
    queryKey: ['todos'], // expect: exhaustive-deps
    queryFn: ({ pageParam, signal }) => api.getTodos({ filter, cursor: pageParam }, { signal }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next,
  })
}

// Values passed as call ARGUMENTS are dependencies (only the call target itself is exempt).
export function useArgument(todoId: string) {
  const todos = useTodosApi()
  return useQuery({ queryKey: ['todo'], queryFn: () => todos.get(todoId) }) // expect: exhaustive-deps
}

// A module-level key does not mention the component's state.
const TODOS_KEY = ['todos'] as const
export function useModuleKey(page: number) {
  return useQuery({ queryKey: TODOS_KEY, queryFn: () => api.getTodos(page) }) // expect: exhaustive-deps
}

// Reads in nested callbacks and template literals count.
export function useNested(prefix: string, ids: Array<string>) {
  return useQuery({
    queryKey: ['nested', ids], // expect: exhaustive-deps
    queryFn: () => Promise.all(ids.map((id) => fetch(`/api/${prefix}/${id}`))),
  })
}

// Class methods are functions too (upstream: MethodDefinition > FunctionExpression).
export class TodoStore {
  detail(todoId: string) {
    return queryOptions({ queryKey: ['todo'], queryFn: () => api.getTodo(todoId) }) // expect: exhaustive-deps
  }
}

// Two queries in one component are checked independently.
export function TwoQueries({ userId, teamId }) {
  const user = useQuery({ queryKey: ['user', userId], queryFn: () => api.getUser(userId) })
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.getTeam(teamId) }) // expect: exhaustive-deps
  return [user, team]
}

// Module-level keys: multi-declarator statements, exported declarations, `satisfies`.
const unrelated = 1,
  MULTI_KEY = ['multi']
export const EXPORTED_KEY = ['exported']
export function useModuleKeys(todoId: string) {
  useQuery({ queryKey: MULTI_KEY, queryFn: () => api.getTodo(todoId, unrelated) }) // expect: exhaustive-deps
  useQuery({ queryKey: EXPORTED_KEY, queryFn: () => api.getTodo(todoId) }) // expect: exhaustive-deps
  const key = ['satisfies'] satisfies Array<string>
  return useQuery({ queryKey: key, queryFn: () => api.getTodo(todoId) }) // expect: exhaustive-deps
}

// Class property arrow functions are the outermost function of their query.
export class TodoService {
  detail = (todoId: string) => queryOptions({ queryKey: ['todo'], queryFn: () => api.getTodo(todoId) }) // expect: exhaustive-deps
}

declare function useTodosApi(): any
declare function withRetry<T>(fn: () => T): () => T

// Regression (false negatives found in review): a call target that is also read inside the
// call's own arguments is a dependency there (upstream: `date`, `service.id`).
export function useCallTargetAsArgument(date, service) {
  useQuery({ queryKey: ['formatted'], queryFn: () => date.format(date) }) // expect: exhaustive-deps
  return useQuery({ queryKey: ['service'], queryFn: () => service.fetch(service.id) }) // expect: exhaustive-deps
}

// Regression: a parenthesized inline queryFn is scanned (ESTree has no parentheses node).
export function useParenthesizedQueryFn(todoId: string) {
  return useQuery({ queryKey: ['paren'], queryFn: (async () => api.getTodo(todoId)) }) // expect: exhaustive-deps
}

// Only a DIRECT `new` callee is exempt, as upstream: `new sdk.Client()` needs `sdk`.
export function useNewMemberCallee(sdk, todoId: string) {
  return useQuery({ queryKey: ['client', todoId], queryFn: () => new sdk.Client(todoId).get() }) // expect: exhaustive-deps
}

// Destructured parameters with defaults and type annotations are still parameters.
export function useParameterDefaults({ page = 1, size }: { page?: number; size: number }) {
  return useQuery({ queryKey: ['defaults', size], queryFn: () => api.getTodos(page, size) }) // expect: exhaustive-deps
}

// A key resolved through `as unknown as ...` can still miss a dependency (missing: page).
export function useWrappedKeyMissing(todoId: string, page: number) {
  const key = ['todo', todoId]
  return useQuery({ queryKey: key as unknown as ReadonlyArray<unknown>, queryFn: () => api.getTodo(todoId, page) }) // expect: exhaustive-deps
}

// Identifiers used inside the key are not dereferenced, as upstream: `base` does not cover
// `filters` (missing: filters).
export function useSpreadKey(filters: object, page: number) {
  const base = ['todos', filters]
  return useQuery({ queryKey: [...base, page], queryFn: () => api.getTodos(filters, page) }) // expect: exhaustive-deps
}

// DIFFERENCE FROM UPSTREAM: a function nested in a non-function branch of a ternary queryFn is
// scanned too. Upstream skips the whole `withRetry(...)` branch; the read of `todoId` is real.
export function useWrappedBranch(todoId: string, ready: boolean) {
  return useQuery({ queryKey: ['wrapped'], queryFn: ready ? withRetry(() => api.getTodo(todoId)) : skipToken }) // expect: exhaustive-deps
}

// Getters and constructors are functions too.
export class TodoRepository {
  constructor(private readonly locale: string) {}
  get todayQuery() {
    const day = new Date().toISOString()
    return queryOptions({ queryKey: ['today', this.locale], queryFn: () => api.getDay(day) }) // expect: exhaustive-deps
  }
}
