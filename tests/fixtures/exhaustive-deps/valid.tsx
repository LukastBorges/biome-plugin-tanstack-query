// Cases ported from the upstream test suite (packages/eslint-plugin-query/src/__tests__/exhaustive-deps.test.ts
// at @tanstack/eslint-plugin-query@5.104.1) plus our own near-misses. Nothing in this file may be reported.
import { injectQuery } from '@tanstack/angular-query-experimental'
import * as ReactQuery from '@tanstack/react-query'
import { queryOptions, skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { createQuery } from '@tanstack/solid-query'
import { createQuery as createSvelteQuery } from '@tanstack/svelte-query'
import { useQuery as useVueQuery } from '@tanstack/vue-query'
import axios from 'axios'
import { fetchTodos } from './api'
import useApi from './useApi'

declare const api: any
declare function fetchTodo(...args: Array<unknown>): Promise<unknown>
declare function fetchEntity(...args: Array<unknown>): Promise<unknown>
declare function fetchA(...args: Array<unknown>): Promise<unknown>
declare function fetchB(...args: Array<unknown>): Promise<unknown>
declare function sendQuery(...args: Array<unknown>): Promise<unknown>
declare function reactive<T>(value: T): T
declare function useTodos(): any

// upstream: should pass when deps are passed in array (react / solid)
useQuery({ queryKey: ['todos'], queryFn: fetchTodos })
createQuery(() => ({ queryKey: ['todos'], queryFn: fetchTodos }))

// upstream: should pass when deps are passed in array / template literal
export function InArray(id: string) {
  useQuery({ queryKey: ['entity', id], queryFn: () => api.getEntity(id) })
  useQuery({ queryKey: [`entity/${id}`], queryFn: () => api.getEntity(id) })
}

// upstream: fetch / axios.get / api.entity.get are call targets, not dependencies
export function CallTargets(id: string) {
  useQuery({ queryKey: ['entity', id], queryFn: () => fetch(id) })
  useQuery({ queryKey: ['entity', id], queryFn: () => axios.get(id) })
  useQuery({ queryKey: ['entity', id], queryFn: () => api.entity.get(id) })
}

// upstream: should pass api when its member is being invoked
export const useFoo = () => {
  const api = useApi()
  return useQuery({
    queryKey: ['foo', api],
    queryFn: () => api.fetchFoo(),
  })
}

// upstream: should not require a component scoped function call target in queryKey
export function ScopedCallTarget({ todoId }) {
  const fetchTodoById = (id) => Promise.resolve(id)

  return useQuery({
    queryKey: ['todos', todoId],
    queryFn: () => fetchTodoById(todoId),
  })
}

// upstream: should not require a method call receiver in queryKey
export function MethodReceiver({ todoId }) {
  const todos = useTodos()

  return useQuery({
    queryKey: ['todo', todoId],
    queryFn: () => todos.getTodo(todoId),
  })
}

// upstream: should not require a data method receiver in queryKey
export function DataMethodReceiver({ items }) {
  useQuery({
    queryKey: ['items'],
    queryFn: () => items?.map((item) => item.id),
  })
}

// upstream: props.src, !!props.id, props?.id, props!.id
export function MyComponent(props) {
  useQuery({ queryKey: ['entity', props.src], queryFn: () => api.entity.get(props.src) })
  useQuery({ queryKey: ['entity', !!props.id], queryFn: () => api.entity.get(props.id) })
  useQuery({ queryKey: ['entity', props?.id], queryFn: () => api.entity.get(props?.id) })
  useQuery({ queryKey: ['entity', props!.id], queryFn: () => api.entity.get(props!.id) })
}

// upstream: should ignore keys from callback
export function KeysFromCallback(props, dep1) {
  useQuery({
    queryKey: ['foo', dep1],
    queryFn: ({ queryKey: [, dep] }) => fetch(dep),
  })
}

// upstream: should ignore type identifiers / type parameters
type Result = {}
export function TypeIdentifiers(dep) {
  useQuery({
    queryKey: ['foo', dep],
    queryFn: () => api.get<Result>(dep),
  })
}
export function useThing<TData>() {
  return useQuery({
    queryKey: ['thing'],
    queryFn: (): Promise<TData> => Promise.reject(new Error('nope')),
  })
}

// upstream: should add "...args" to deps
function foo(...args) {
  return args
}
export function useData(arg, ...args) {
  return useQuery({
    queryKey: ['foo', arg, ...args],
    queryFn: async () => foo([arg, ...args]),
  })
}

// upstream: should not add class to deps (here declared inside the component, so it is in scope)
export function ClassInstance() {
  class Foo {}
  useQuery({ queryKey: ['foo'], queryFn: async () => new Foo() })
}

// upstream: should not add `undefined` to deps
export function UndefinedIsNotADep() {
  useQuery({
    queryKey: [],
    queryFn: async () => {
      if (undefined) {
        return null
      }
      return 1
    },
  })
}

// upstream: query key factories receiving the dependency in any shape
const fooQueryKeyFactory = {
  foo: (..._args: Array<unknown>) => ['foo'] as const,
  num: (num: number) => [...fooQueryKeyFactory.foo(), num] as const,
}
export const useFactoryArg = (num: number) =>
  useQuery({ queryKey: fooQueryKeyFactory.foo(num), queryFn: () => Promise.resolve(num) })
export const useFactoryObject = (num: number) =>
  useQuery({ queryKey: fooQueryKeyFactory.foo({ x: num }), queryFn: () => Promise.resolve(num) })
export const useFactoryShorthand = (num: number) =>
  useQuery({ queryKey: fooQueryKeyFactory.foo({ num }), queryFn: () => Promise.resolve(num) })
export const useFactoryArray = (num: number) =>
  useQuery({ queryKey: fooQueryKeyFactory.foo([num]), queryFn: () => Promise.resolve(num) })
export const useFactorySecondArg = (num: number) =>
  useQuery({ queryKey: fooQueryKeyFactory.foo(1, num), queryFn: () => Promise.resolve(num) })
export const useFactoryMember = (obj: { num: number }) =>
  useQuery({ queryKey: fooQueryKeyFactory.foo(obj.num), queryFn: () => Promise.resolve(obj.num) })

// upstream: should pass with queryKeyFactory result assigned to a variable (1 and 2)
function keyFactory(dep: string) {
  const x = ['foo', dep] as const
  return x
}
export const useAssignedFactory = (dep: string) => {
  const queryKey = keyFactory(dep)
  return useQuery({
    queryKey,
    queryFn: () => Promise.resolve(dep),
  })
}

// upstream: should pass when queryKey is a chained queryKeyFactory while having deps in nested calls
const chainedFactory = {
  foo: (num: number) => ({
    detail: (flag: boolean) => ['foo', num, flag] as const,
  }),
}
export const useChained = (num: number, flag: boolean) =>
  useQuery({
    queryKey: chainedFactory.foo(num).detail(flag),
    queryFn: () => Promise.resolve({ num, flag }),
  })

// upstream: should not treat new Error as missing dependency
export function NewError(message: string) {
  useQuery({
    queryKey: ['foo'],
    queryFn: () => Promise.reject(new Error(message)),
  })
}

// upstream: const assertions, directly and through variables
export const useAsConst = (id: number) => {
  return useQuery({
    queryKey: ['foo', id] as const,
    queryFn: async () => id,
  })
}
export const useDereferencedAsConst = (id: number) => {
  const queryKey = ['foo', id]
  return useQuery({
    queryKey: queryKey as const,
    queryFn: async () => id,
  })
}
export const useAssignedAsConst = (id: number) => {
  const queryKey = ['foo', id] as const
  return useQuery({
    queryKey,
    queryFn: async () => id,
  })
}

// upstream: should not fail if queryKey is having the whole object while queryFn uses some props of it
export function WholeObject() {
  const state = { foo: 'foo', bar: 'bar' }

  useQuery({
    queryKey: ['state', state],
    queryFn: () => Promise.resolve({ foo: state.foo, bar: state.bar }),
  })
}

// upstream: should not fail if queryKey does not include an internal dependency
export function InternalDependency() {
  useQuery({
    queryKey: ['api'],
    queryFn: async () => {
      const response = await fetch('/api')
      const data = await response.json()
      return data[0].name
    },
  })
}

// upstream: should ignore constants defined out of scope (components, hooks, plain functions)
const CONST_VAL = 1
export function ConstDeclaration() {
  useQuery({ queryKey: ['foo'], queryFn: () => CONST_VAL })
}
export const ConstArrow = () => {
  useQuery({ queryKey: ['foo'], queryFn: () => CONST_VAL })
}
export const ConstFunctionExpression = function () {
  useQuery({ queryKey: ['foo'], queryFn: () => CONST_VAL })
}
export function fn() {
  return {
    queryKey: ['foo'],
    queryFn: () => CONST_VAL,
  }
}

// upstream: query key with nullish coalescing operator
const factory = (id: number) => ['foo', id]
export function NullishKey({ id }) {
  useQuery({
    queryKey: factory(id ?? -1),
    queryFn: () => Promise.resolve({ id }),
  })
}

// upstream: conditional / binary / nested type assertion / callback-derived keys
export function DerivedKeys({ cond, a, b }, dep, ids, prefix) {
  useQuery({ queryKey: ['thing', cond ? a : b], queryFn: () => (cond ? a : b) })
  useQuery({ queryKey: ['thing', a + b], queryFn: () => a + b })
  useQuery({ queryKey: ['thing', dep as string], queryFn: () => dep })
  useQuery({
    queryKey: ['thing', ids.map((id) => prefix + '-' + id)],
    queryFn: () => ({ ids, prefix }),
  })
}

// upstream: instanceof value should not be in query key
class SomeClass {}
export function InstanceOf({ value }) {
  useQuery({
    queryKey: ['foo', value],
    queryFn: () => {
      return value instanceof SomeClass
    },
  })
}
export function useInstanceOfDate(value) {
  return useQuery({
    queryKey: ['thing', value],
    queryFn: () => {
      return value instanceof Date
    },
  })
}

// upstream: queryFn as a ternary expression with dep and a skipToken (both orders)
const enabled = true
export function TernarySkipToken({ id }, condition) {
  useQuery({ queryKey: [id], queryFn: enabled ? () => Promise.resolve(id) : skipToken })
  useQuery({ queryKey: ['thing', id], queryFn: condition ? skipToken : () => id })
}

// upstream: should not fail when queryFn uses nullish coalescing operator
export function NullishQueryFn(options) {
  useQuery({
    queryKey: ['foo', options],
    queryFn: () => options?.params ?? options,
  })
}

// upstream: queryKey uses arrow function / function expression to produce a key (Vue reactivity)
export function ReactiveKey() {
  const obj = reactive<{ boo?: string }>({})
  useVueQuery({
    queryKey: ['foo', () => obj.boo],
    queryFn: () => fetch(`/mock/getSomething/${obj.boo}`),
    enabled: () => !!obj.boo,
  })
  useVueQuery({
    queryKey: [
      'foo',
      () => {
        return obj.boo
      },
    ],
    queryFn: () => fetch(`/mock/getSomething/${obj.boo}`),
  })
  useVueQuery({
    queryKey: [
      'foo',
      function () {
        return obj.boo
      },
    ],
    queryFn: () => fetch(`/mock/getSomething/${obj.boo}`),
  })
}

// upstream: queryFn inside queryOptions referencing an external (module-level) variable
const EXTERNAL = 1
export const queries = {
  foo: queryOptions({
    queryKey: ['foo'],
    queryFn: () => Promise.resolve(EXTERNAL),
  }),
}

// upstream: optional chaining in the key, plain / non-null access in the queryFn
export function useOptionalChaining(data?: any) {
  useQuery({
    queryKey: ['query-name', data?.address],
    queryFn: async () => sendQuery(data.address),
    enabled: !!data?.address,
  })
  useQuery({
    queryKey: ['query-name', data?.address],
    queryFn: async () => sendQuery(data!.address),
  })
  return useQuery({
    queryKey: ['query-name', data?.address],
    queryFn: async () => sendQuery(data!.address!),
  })
}

// upstream (Vue <script setup> cases): module-level code is never checked outside .vue files
const entityId = 1
useVueQuery({ queryKey: ['entity', entityId], queryFn: () => fetchEntity(entityId) })
useVueQuery({ queryKey: ['todos'], queryFn: () => fetchTodos() })
useVueQuery({ queryKey: ['entity', entityId], queryFn: () => fetch(`/api/entity/${entityId}`) })

// upstream: deps used in then/catch and try/catch/finally are listed
export function ThenCatch() {
  const id = 1
  useQuery({
    queryKey: ['foo', id],
    queryFn: () =>
      Promise.resolve(null)
        .then(() => id)
        .catch(() => id),
  })
  useQuery({
    queryKey: ['bar', id],
    queryFn: () => {
      try {
        return fetch(String(id))
      } catch (error) {
        console.error(error)
        return id
      } finally {
        console.log('done')
      }
    },
  })
}

// upstream: member method calls covered by the root, by member paths, or receivers omitted
export function useMemberCalls(a) {
  useQuery({
    queryKey: ['thing', a],
    queryFn: () => {
      a.b.foo()
      a.c.bar()
      return 1
    },
  })
  useQuery({
    queryKey: ['thing', a.b, a.c],
    queryFn: () => {
      a.b.foo()
      a.c.bar()
      return 1
    },
  })
  useQuery({ queryKey: ['thing'], queryFn: () => a?.foo() })
  useQuery({ queryKey: ['thing'], queryFn: () => a!.foo() })
  return useQuery({
    queryKey: ['thing'],
    queryFn: () => {
      a.b.foo()
      a.c.bar()
      return 1
    },
  })
}

// upstream: key referencing an identifier pointing to an array
export function useKeyIdentifier(dep) {
  const key = ['thing', dep]
  return useQuery({
    queryKey: key,
    queryFn: () => dep,
  })
}

// upstream: key with object spread, call expressions with member / identifier callees
export function useCallKeys(dep1, dep2, api, dep, obj) {
  const makeKeyPart = (value) => value
  useQuery({ queryKey: ['thing', { ...dep1, prop: dep2 }], queryFn: () => dep1.prop + dep2 })
  useQuery({ queryKey: ['thing', api.createKey()], queryFn: () => api.fetch() })
  useQuery({ queryKey: ['thing', makeKeyPart(dep)], queryFn: () => makeKeyPart(dep) })
  return useQuery({ queryKey: ['thing', obj.api.createKey()], queryFn: () => obj.api.fetch() })
}

// upstream: ternary queryFn with both branches' deps in the key
export function useBothBranches(condition, a, b) {
  return useQuery({
    queryKey: ['thing', a, b],
    queryFn: condition ? () => fetchA(a) : () => fetchB(b),
  })
}

// upstream: should not require a nested method call receiver in queryKey
export function NestedReceiver(props) {
  const entities = props.entities

  return useQuery({
    queryKey: ['get-stuff'],
    queryFn: () => {
      return api.fetchStuff({
        ids: entities.map((o) => o.id),
      })
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Our own near-misses
// ---------------------------------------------------------------------------------------------

// Not an inline queryFn: upstream only inspects arrow / function expressions / ternaries.
export function NotInline(todoId: string, makeFetcher) {
  useQuery({ queryKey: ['todo'], queryFn: fetchTodo })
  useQuery({ queryKey: ['todo'], queryFn: makeFetcher(todoId) })
}

// No queryFn at all (invalidation filters, mutations).
export function Invalidate(todoId: string) {
  const queryClient = useQueryClient()
  queryClient.invalidateQueries({ queryKey: ['todo'], exact: true })
  return { mutationKey: ['todo'], mutationFn: () => api.updateTodo(todoId) }
}

// String-literal / computed `queryKey` property names are not identifiers (upstream ignores them).
export function QuotedKeys(todoId: string) {
  const name = 'queryKey'
  return [
    { 'queryKey': ['todo'], queryFn: () => fetchTodo(todoId) },
    { [name]: ['todo'], queryFn: () => fetchTodo(todoId) },
  ]
}

// Values only written, never read, are not dependencies.
export function WriteOnly() {
  let calls = 0
  useQuery({
    queryKey: ['writes'],
    queryFn: () => {
      calls = 1
      return null
    },
  })
  return calls
}

// Module-level imports, globals and declarations are never dependencies.
export function GlobalsAndImports() {
  useQuery({
    queryKey: ['globals'],
    queryFn: () => fetchTodos().then(() => [window.location.href, JSON.stringify(CONST_VAL), Math.random()]),
  })
}

// Optional call targets (`onDone?.()`) and parenthesized / non-null receivers.
export function OptionalCallTargets(onDone, client, todoId) {
  useQuery({
    queryKey: ['todo', todoId],
    queryFn: async () => {
      const todo = await client!.todos.get(todoId)
      onDone?.(todo)
      return todo
    },
  })
}

// A same-named binding inside the queryFn shadows the outer variable.
export function ShadowedInQueryFn(id: string, ids: Array<string>) {
  useQuery({
    queryKey: ['ids', ids],
    queryFn: () => Promise.all(ids.map((id) => fetchTodo(id))),
  })
  useQuery({
    queryKey: ['local'],
    queryFn: () => {
      const id = 'local'
      return fetchTodo(id)
    },
  })
  return id
}

// Variables declared in a nested block or in an intermediate function are not in the outermost
// function's scope; upstream does not report them either.
export function NestedScopes(flag: boolean) {
  if (flag) {
    const blockScoped = 1
    useQuery({ queryKey: ['block'], queryFn: () => blockScoped })
  }
  const makeQuery = (inner: string) => ({ queryKey: ['inner'], queryFn: () => fetchTodo(inner) })
  return makeQuery
}

// A module-level key name shadowed by a parameter cannot be resolved structurally: no report.
const SHADOWED_KEY = ['shadowed']
export function useShadowedModuleKey(SHADOWED_KEY: Array<string>, todoId: string) {
  return useQuery({ queryKey: SHADOWED_KEY, queryFn: () => fetchTodo(todoId) })
}

// A key received from the caller cannot be resolved structurally: no report.
export function useKeyFromProps(queryKey: Array<unknown>, todoId: string) {
  return useQuery({ queryKey, queryFn: () => fetchTodo(todoId) })
}

// The key is built from a dependency in a different form.
export function DifferentForms(todoId: number, filters: { status: string }) {
  useQuery({ queryKey: ['todo', String(todoId)], queryFn: () => fetchTodo(todoId) })
  useQuery({ queryKey: ['todos', { ...filters }], queryFn: () => api.getTodos(filters.status) })
  useQuery({ queryKey: ['todos', `${filters.status}`], queryFn: () => api.getTodos(filters.status) })
}

// Class declared inside the component, used only with `new`.
export function NewInstance(config) {
  class Client {}
  useQuery({ queryKey: ['client', config], queryFn: () => new Client() })
}

// Regression (false positives found in review): names bound inside a parameter's type annotation,
// inside a default value or inside a destructuring default are not declarations of the
// component. `url` and `pageSize` below are module-level, so they are never dependencies.
const url = 'https://example.com/api'
const pageSize = 20
export function TypeAnnotationBinding({ onChange }: { onChange: (url: string) => void }) {
  onChange(url)
  return useQuery({ queryKey: ['annotation'], queryFn: () => fetchTodo(url) })
}
export function DefaultValueBinding({ render = (pageSize: number) => pageSize }) {
  render(pageSize)
  return useQuery({ queryKey: ['default'], queryFn: () => fetchTodo(pageSize) })
}
export function DestructuringDefault(props) {
  const { pick = (url: string) => url } = props
  pick(url)
  return useQuery({ queryKey: ['destructuring'], queryFn: () => fetchTodo(url) })
}

// Regression: keys behind several type assertions, a non-null assertion or parentheses are
// resolved through them (upstream strips `as` the same way).
export function WrappedKeys(todoId: string) {
  const key = ['todo', todoId]
  useQuery({ queryKey: key as unknown as ReadonlyArray<string>, queryFn: () => fetchTodo(todoId) })
  useQuery({ queryKey: (key as Array<string>), queryFn: () => fetchTodo(todoId) })
  return useQuery({ queryKey: key!, queryFn: () => fetchTodo(todoId) })
}
// ...and an alias whose initializer is itself a wrapped reference is not resolved further.
export function WrappedAlias(todoId: string) {
  const base = ['todo', todoId]
  const key = (base as unknown) as Array<string>
  return useQuery({ queryKey: key, queryFn: () => fetchTodo(todoId) })
}

// Regression: a call target used again as the target of a call in the arguments.
export function NestedCallTargets(client, todoId: string) {
  return useQuery({ queryKey: ['todo', todoId], queryFn: () => client.fetch(client.url(todoId)) })
}
// Call targets with member chains longer than the unrolled depth.
export function DeepCallTarget(sdk, todoId: string) {
  return useQuery({ queryKey: ['deep', todoId], queryFn: () => sdk.a.b.c.d.e.f.g.h.i.get(todoId) })
}

// Other adapters and call shapes, with complete keys.
export function NamespaceImport({ id }: { id: string }) {
  return ReactQuery.useQuery({ queryKey: ['ns', id], queryFn: () => fetchTodo(id) })
}
export function svelteTodo(id: string) {
  return createSvelteQuery(() => ({ queryKey: ['svelte', id], queryFn: () => fetchTodo(id) }))
}
export function OuterComponent({ teamId }: { teamId: string }) {
  function Member({ userId }: { userId: string }) {
    return useQuery({ queryKey: ['member', teamId, userId], queryFn: () => api.member(teamId, userId) })
  }
  return Member
}
// `this.todoId` is not an identifier read (upstream ignores `this` too).
export class TodoComponent {
  todoId = '1'
  query = injectQuery(() => ({ queryKey: ['angular'], queryFn: () => fetchTodo(this.todoId) }))
}

// KNOWN FALSE NEGATIVES: upstream reports every query below; this port does not (see the
// "Coverage vs. upstream" section of docs/rules/exhaustive-deps.md).
export function KnownFalseNegatives(id: string, ids: Array<string>, flag: boolean) {
  const state = { foo: 'foo', bar: 'bar' }
  // upstream: "missing: state.bar" (any read of `state` in the key covers every `state.*` here)
  useQuery({
    queryKey: ['state', state.foo],
    queryFn: () => Promise.resolve({ foo: state.foo, bar: state.bar }),
  })
  // upstream: "missing: id" (the callback parameter `id` hides the outer `id` for this port)
  useQuery({
    queryKey: ['ids', ids],
    queryFn: () => Promise.all([fetchTodo(id), ...ids.map((id) => fetchTodo(id))]),
  })
  // upstream: "missing: hoisted" (a `var` in a nested block is not seen as declared here)
  if (flag) {
    var hoisted = 1
  }
  let attempts = 0
  useQuery({ queryKey: ['hoisted'], queryFn: () => fetchTodo(hoisted) })
  // upstream: "missing: attempts" (`x++` / `x += 1` are not treated as reads)
  useQuery({ queryKey: ['attempts'], queryFn: () => fetchTodo(attempts++) })
}
