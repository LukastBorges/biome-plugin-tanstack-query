#!/usr/bin/env node
// Benchmarks this plugin on Biome against @tanstack/eslint-plugin-query on
// ESLint, on the same generated codebase.
//
// - The corpus is a deterministic, synthetic React + TanStack Query codebase:
//   components, custom hooks, infinite lists, mutations and plain utility
//   modules. A seeded fraction of files contains one known violation each.
// - ESLint runs @tanstack/eslint-plugin-query at the version this repository
//   mirrors (package.json#upstream.version) with its `flat/recommended` config,
//   untyped and with type information (`projectService`), single-threaded and
//   with `--concurrency=auto`.
// - Biome runs the locally built `rules/index.grit` (and the standalone rule
//   files), plus a run without plugins as a baseline.
// - Every configuration is timed end-to-end (process start to exit, JSON output
//   written to a file) after one warm-up run; the median and minimum are shown.
//   Findings are counted per rule to check that both sides do comparable work.
//
// The ESLint toolchain is installed into `.bench/` (gitignored) on first use.
//
// Usage:
//   node scripts/benchmark.js [--files 300] [--runs 5] [--seed 1] [--no-typed] [--json]

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism, cpus, platform, release } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { PRESETS } from './build-index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BENCH = join(ROOT, '.bench')
const SRC = join(BENCH, 'src')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const BIOME_BIN = join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome')

// Pinned so results are reproducible. typescript-eslint 8 supports TypeScript < 6.1.
const TOOLCHAIN = {
  eslint: '10.12.0',
  'typescript-eslint': '8.71.0',
  typescript: '6.0.3',
  [pkg.upstream.package]: pkg.upstream.version,
  '@tanstack/react-query': '5.104.1',
  '@types/react': '19.3.0',
}

const { values: options } = parseArgs({
  options: {
    files: { type: 'string', default: '300' },
    runs: { type: 'string', default: '5' },
    seed: { type: 'string', default: '1' },
    'no-typed': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
})
const FILES = Number(options.files)
const RUNS = Number(options.runs)
const SEED = Number(options.seed)

const log = (message) => process.stderr.write(`${message}\n`)

// ---------------------------------------------------------------------------
// Toolchain
// ---------------------------------------------------------------------------

function installToolchain() {
  const stamp = join(BENCH, 'node_modules', '.toolchain.json')
  const wanted = JSON.stringify(TOOLCHAIN)
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted) return

  log(`Installing the ESLint toolchain into .bench/ (${Object.keys(TOOLCHAIN).join(', ')}) ...`)
  mkdirSync(BENCH, { recursive: true })
  writeFileSync(
    join(BENCH, 'package.json'),
    `${JSON.stringify({ name: 'benchmark-workspace', private: true, type: 'module', devDependencies: TOOLCHAIN }, null, 2)}\n`,
  )
  const result = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error'], {
    cwd: BENCH,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) throw new Error('npm install failed in .bench/')
  writeFileSync(stamp, wanted)
}

function version(bin, args = ['--version']) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' })
    .stdout.trim()
    .replace(/^Version:\s*/, '')
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

/** mulberry32: tiny deterministic PRNG. */
function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ENTITIES = ['todo', 'user', 'project', 'invoice', 'comment', 'order', 'product', 'ticket', 'team', 'report']
const cap = (s) => s[0].toUpperCase() + s.slice(1)

/** Upstream rule each injected violation must trigger. */
const VIOLATIONS = [
  'exhaustive-deps',
  'no-rest-destructuring',
  'stable-query-client',
  'no-unstable-deps',
  'infinite-query-property-order',
  'mutation-property-order',
  'no-void-query-fn',
]

function apiModule() {
  const lines = ['// Shared API client used by every generated module.', '']
  for (const e of ENTITIES) {
    const E = cap(e)
    lines.push(
      `export interface ${E} {`,
      '  id: string',
      '  name: string',
      '  createdAt: string',
      '  tags: string[]',
      '}',
      '',
      `export async function fetch${E}(id: string): Promise<${E}> {`,
      `  const response = await fetch(\`/api/${e}s/\${id}\`)`,
      `  return (await response.json()) as ${E}`,
      '}',
      '',
      `export async function fetch${E}s(filter: string, page = 0): Promise<{ items: ${E}[]; next?: number }> {`,
      `  const response = await fetch(\`/api/${e}s?filter=\${filter}&page=\${page}\`)`,
      `  return (await response.json()) as { items: ${E}[]; next?: number }`,
      '}',
      '',
      `export async function save${E}(input: Partial<${E}>): Promise<${E}> {`,
      `  const response = await fetch('/api/${e}s', { method: 'POST', body: JSON.stringify(input) })`,
      `  return (await response.json()) as ${E}`,
      '}',
      '',
      `export async function track${E}View(id: string): Promise<void> {`,
      `  await fetch(\`/api/${e}s/\${id}/views\`, { method: 'POST' })`,
      '}',
      '',
    )
  }
  return lines.join('\n')
}

function table(E, rows) {
  const cells = ['id', 'name', 'createdAt', 'tags']
  return [
    '    <table className="table">',
    '      <thead>',
    `        <tr>${cells.map((c) => `<th>${c}</th>`).join('')}</tr>`,
    '      </thead>',
    '      <tbody>',
    `        {${rows}.map((item: ${E}) => (`,
    '          <tr key={item.id}>',
    '            <td>{item.id}</td>',
    '            <td>{item.name}</td>',
    '            <td>{new Date(item.createdAt).toLocaleDateString()}</td>',
    "            <td>{item.tags.join(', ')}</td>",
    '          </tr>',
    '        ))}',
    '      </tbody>',
    '    </table>',
  ]
}

function filler(rand, name) {
  const n = 2 + Math.floor(rand() * 4)
  const out = []
  for (let i = 0; i < n; i++) {
    out.push(
      `function ${name}Format${i}(value: string, width = ${8 + i}): string {`,
      '  const trimmed = value.trim()',
      '  if (trimmed.length > width) {',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: this is generated source code, not a template
      '    return `${trimmed.slice(0, width - 1)}…`',
      '  }',
      "  return trimmed.padEnd(width, ' ')",
      '}',
      '',
    )
  }
  return out
}

function queryComponent(rand, index, violation) {
  const e = ENTITIES[index % ENTITIES.length]
  const E = cap(e)
  const name = `${E}List${index}`
  const imports = new Set(['useQuery'])
  const body = []
  const prelude = []

  const key = violation === 'exhaustive-deps' ? `['${e}s']` : `['${e}s', filter]`
  const destructure =
    violation === 'no-rest-destructuring' ? '{ data, isPending, ...query }' : '{ data, isPending, error }'
  body.push(
    `  const ${destructure} = useQuery({`,
    `    queryKey: ${key},`,
    `    queryFn: () => fetch${E}s(filter),`,
    '    staleTime: 30_000,',
    '  })',
  )
  if (violation === 'stable-query-client') {
    imports.add('QueryClient')
    body.unshift('  const queryClient = new QueryClient()')
    prelude.push('  void queryClient')
  }
  if (violation === 'no-unstable-deps') {
    imports.add('useQuery')
    body.push(
      `  const selected = useQuery({ queryKey: ['${e}', selectedId], queryFn: () => fetch${E}(selectedId) })`,
      '  useEffect(() => {',
      `    document.title = selected.data?.name ?? '${E}s'`,
      '  }, [selected])',
    )
  } else {
    body.push(
      `  const selected = useQuery({ queryKey: ['${e}', selectedId], queryFn: () => fetch${E}(selectedId) })`,
      '  useEffect(() => {',
      `    document.title = selected.data?.name ?? '${E}s'`,
      '  }, [selected.data])',
    )
  }
  if (violation === 'no-void-query-fn') {
    body.push(
      '  useQuery({',
      `    queryKey: ['${e}', selectedId, 'views'],`,
      '    queryFn: async () => {',
      `      await track${E}View(selectedId)`,
      '    },',
      '  })',
    )
  }

  const errorLine = violation === 'no-rest-destructuring' ? 'query.error' : 'error'
  return [
    `import { ${[...imports].sort().join(', ')} } from '@tanstack/react-query'`,
    "import { useEffect, useState } from 'react'",
    `import { fetch${E}, fetch${E}s, track${E}View, type ${E} } from './api'`,
    '',
    ...filler(rand, `${e}${index}`),
    `export function ${name}({ filter }: { filter: string }) {`,
    "  const [selectedId, setSelectedId] = useState('')",
    ...body,
    ...prelude,
    `  void track${E}View`,
    '',
    `  if (isPending) return <p>Loading ${e}s…</p>`,
    `  if (${errorLine}) return <p role="alert">Could not load ${e}s</p>`,
    '',
    '  return (',
    '    <section>',
    `      <h2>${E}s</h2>`,
    '      <button type="button" onClick={() => setSelectedId(data?.items[0]?.id ?? \'\')}>',
    '        Select first',
    '      </button>',
    ...table(E, '(data?.items ?? [])').map((line) => `  ${line}`),
    '    </section>',
    '  )',
    '}',
    '',
  ].join('\n')
}

function mutationComponent(rand, index, violation) {
  const e = ENTITIES[index % ENTITIES.length]
  const E = cap(e)
  const callbacks =
    violation === 'mutation-property-order'
      ? [
          `    onSettled: () => queryClient.invalidateQueries({ queryKey: ['${e}s'] }),`,
          "    onMutate: () => setStatus('saving'),",
        ]
      : [
          "    onMutate: () => setStatus('saving'),",
          `    onSettled: () => queryClient.invalidateQueries({ queryKey: ['${e}s'] }),`,
        ]
  return [
    "import { useMutation, useQueryClient } from '@tanstack/react-query'",
    "import { useState } from 'react'",
    `import { save${E}, type ${E} } from './api'`,
    '',
    ...filler(rand, `${e}Form${index}`),
    `export function ${E}Form${index}({ initial }: { initial?: Partial<${E}> }) {`,
    '  const queryClient = useQueryClient()',
    "  const [status, setStatus] = useState<'idle' | 'saving'>('idle')",
    "  const [name, setName] = useState(initial?.name ?? '')",
    '  const mutation = useMutation({',
    `    mutationFn: (input: Partial<${E}>) => save${E}(input),`,
    ...callbacks,
    "    onError: () => setStatus('idle'),",
    '  })',
    '',
    '  return (',
    '    <form',
    '      onSubmit={(event) => {',
    '        event.preventDefault()',
    '        mutation.mutate({ ...initial, name })',
    '      }}',
    '    >',
    `      <label htmlFor="${e}-name-${index}">Name</label>`,
    `      <input id="${e}-name-${index}" value={name} onChange={(event) => setName(event.target.value)} />`,
    '      <button type="submit" disabled={status === \'saving\'}>',
    "        {status === 'saving' ? 'Saving…' : 'Save'}",
    '      </button>',
    '    </form>',
    '  )',
    '}',
    '',
  ].join('\n')
}

function infiniteComponent(rand, index, violation) {
  const e = ENTITIES[index % ENTITIES.length]
  const E = cap(e)
  const queryFn = `    queryFn: ({ pageParam }) => fetch${E}s(filter, pageParam),`
  const props =
    violation === 'infinite-query-property-order'
      ? [
          `    queryKey: ['${e}s', 'infinite', filter],`,
          '    getNextPageParam: (lastPage) => lastPage.next,',
          queryFn,
          '    initialPageParam: 0,',
        ]
      : [
          `    queryKey: ['${e}s', 'infinite', filter],`,
          queryFn,
          '    initialPageParam: 0,',
          '    getNextPageParam: (lastPage) => lastPage.next,',
        ]
  return [
    "import { useInfiniteQuery } from '@tanstack/react-query'",
    `import { fetch${E}s, type ${E} } from './api'`,
    '',
    ...filler(rand, `${e}Feed${index}`),
    `export function ${E}Feed${index}({ filter }: { filter: string }) {`,
    '  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({',
    ...props,
    '  })',
    '',
    '  const items = data?.pages.flatMap((page) => page.items) ?? []',
    '  return (',
    '    <div>',
    ...table(E, 'items').map((line) => `  ${line}`),
    '      <button type="button" disabled={!hasNextPage || isFetchingNextPage} onClick={() => fetchNextPage()}>',
    "        {isFetchingNextPage ? 'Loading…' : 'Load more'}",
    '      </button>',
    '    </div>',
    '  )',
    '}',
    '',
  ].join('\n')
}

function hooksModule(rand, index) {
  const e = ENTITIES[index % ENTITIES.length]
  const E = cap(e)
  return [
    "import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'",
    `import { fetch${E}, fetch${E}s } from './api'`,
    '',
    `export const ${e}Keys${index} = {`,
    `  all: ['${e}s'] as const,`,
    `  list: (filter: string) => [...${e}Keys${index}.all, 'list', filter] as const,`,
    `  detail: (id: string) => [...${e}Keys${index}.all, 'detail', id] as const,`,
    '}',
    '',
    `export function ${e}ListOptions${index}(filter: string) {`,
    `  return queryOptions({ queryKey: ${e}Keys${index}.list(filter), queryFn: () => fetch${E}s(filter) })`,
    '}',
    '',
    `export function use${E}${index}(id: string) {`,
    `  return useQuery({ queryKey: ['${e}', id], queryFn: () => fetch${E}(id), enabled: id !== '' })`,
    '}',
    '',
    `export function useSuspense${E}${index}(id: string) {`,
    `  return useSuspenseQuery({ queryKey: ['${e}', id], queryFn: () => fetch${E}(id) })`,
    '}',
    '',
    ...filler(rand, `${e}Hooks${index}`),
  ].join('\n')
}

function utilityModule(rand, index) {
  const lines = [`// Utility module ${index}: no TanStack Query code at all.`, '']
  const n = 4 + Math.floor(rand() * 6)
  for (let i = 0; i < n; i++) {
    lines.push(
      `export function compute${index}_${i}(values: number[]): { sum: number; mean: number; max: number } {`,
      '  let sum = 0',
      '  let max = Number.NEGATIVE_INFINITY',
      '  for (const value of values) {',
      '    sum += value',
      '    if (value > max) max = value',
      '  }',
      '  return { sum, mean: values.length === 0 ? 0 : sum / values.length, max }',
      '}',
      '',
    )
  }
  lines.push(...filler(rand, `util${index}`))
  return lines.join('\n')
}

const PROVIDER = `import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } })

export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
`

/** Writes the corpus and returns the number of injected violations per rule. */
function generateCorpus() {
  rmSync(SRC, { recursive: true, force: true })
  mkdirSync(SRC, { recursive: true })
  const rand = prng(SEED)
  const injected = Object.fromEntries(VIOLATIONS.map((rule) => [rule, 0]))
  let lines = 0
  const write = (file, text) => {
    writeFileSync(join(SRC, file), text)
    lines += text.split('\n').length
  }

  write('api.ts', apiModule())
  write('providers.tsx', PROVIDER)

  for (let i = 0; i < FILES - 2; i++) {
    const kind = rand()
    const inject = rand() < 0.15
    let violation
    const pick = (candidates) => {
      if (!inject) return undefined
      violation = candidates[Math.floor(rand() * candidates.length)]
      injected[violation]++
      return violation
    }
    if (kind < 0.35) {
      write(
        `query-${i}.tsx`,
        queryComponent(
          rand,
          i,
          pick([
            'exhaustive-deps',
            'no-rest-destructuring',
            'stable-query-client',
            'no-unstable-deps',
            'no-void-query-fn',
          ]),
        ),
      )
    } else if (kind < 0.55) {
      write(`mutation-${i}.tsx`, mutationComponent(rand, i, pick(['mutation-property-order'])))
    } else if (kind < 0.7) {
      write(`feed-${i}.tsx`, infiniteComponent(rand, i, pick(['infinite-query-property-order'])))
    } else if (kind < 0.85) {
      write(`hooks-${i}.ts`, hooksModule(rand, i))
    } else {
      write(`util-${i}.ts`, utilityModule(rand, i))
    }
  }
  return { injected, lines }
}

// ---------------------------------------------------------------------------
// Configurations
// ---------------------------------------------------------------------------

function writeConfigs() {
  writeFileSync(
    join(BENCH, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`,
  )

  const eslintConfig = (typed) => `import pluginQuery from '${pkg.upstream.package}'
import tseslint from 'typescript-eslint'

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: ${typed ? '{ projectService: true, tsconfigRootDir: import.meta.dirname }' : '{ ecmaFeatures: { jsx: true } }'},
    },
  },
  ...pluginQuery.configs['flat/recommended'],
]
`
  writeFileSync(join(BENCH, 'eslint.untyped.config.mjs'), eslintConfig(false))
  writeFileSync(join(BENCH, 'eslint.typed.config.mjs'), eslintConfig(true))
  writeFileSync(
    join(BENCH, 'eslint.parse-only.config.mjs'),
    `import tseslint from 'typescript-eslint'

export default [{ files: ['src/**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } }]
`,
  )

  const biomeConfig = (plugins) => ({
    root: true,
    vcs: { enabled: false },
    formatter: { enabled: false },
    assist: { enabled: false },
    linter: { enabled: true, rules: { preset: 'none' } },
    plugins,
  })
  const standalone = PRESETS.index.rules.map((rule) => join(ROOT, 'rules', `${rule}.grit`))
  mkdirSync(join(BENCH, 'biome'), { recursive: true })
  for (const [name, plugins] of [
    ['none', []],
    ['index', [join(ROOT, 'rules', 'index.grit')]],
    ['standalone', standalone],
  ]) {
    mkdirSync(join(BENCH, 'biome', name), { recursive: true })
    writeFileSync(join(BENCH, 'biome', name, 'biome.json'), `${JSON.stringify(biomeConfig(plugins), null, 2)}\n`)
  }
}

const ESLINT_BIN = () => join(BENCH, 'node_modules', 'eslint', 'bin', 'eslint.js')
const OUT = () => join(BENCH, 'out.json')

function eslintCase(label, config, concurrency) {
  return {
    label,
    tool: 'eslint',
    command: [
      process.execPath,
      ESLINT_BIN(),
      '--config',
      config,
      '--no-config-lookup',
      '--format',
      'json',
      '--output-file',
      OUT(),
      ...(concurrency ? ['--concurrency', concurrency] : []),
      'src',
    ],
    env: {},
  }
}

function biomeCase(label, configDir, env = {}) {
  return {
    label,
    tool: 'biome',
    command: [
      process.execPath,
      BIOME_BIN,
      'lint',
      `--config-path=${join(BENCH, 'biome', configDir)}`,
      '--reporter=json',
      `--reporter-file=${OUT()}`,
      '--max-diagnostics=none',
      'src',
    ],
    env,
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

function runOnce(testCase) {
  rmSync(OUT(), { force: true })
  const start = process.hrtime.bigint()
  const result = spawnSync(testCase.command[0], testCase.command.slice(1), {
    cwd: BENCH,
    env: { ...process.env, BIOME_BINARY: undefined, ...testCase.env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  const ms = Number(process.hrtime.bigint() - start) / 1e6
  // Both tools exit with 1 when they report errors.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`${testCase.label} failed (exit ${result.status}):\n${result.stderr}`)
  }
  return { ms, findings: countFindings(testCase.tool) }
}

function countFindings(tool) {
  if (!existsSync(OUT())) return {}
  const raw = readFileSync(OUT(), 'utf8')
  const counts = {}
  const add = (rule) => {
    counts[rule] = (counts[rule] ?? 0) + 1
  }
  if (tool === 'eslint') {
    for (const file of JSON.parse(raw)) {
      for (const message of file.messages) {
        if (message.fatal) throw new Error(`ESLint could not parse ${file.filePath}: ${message.message}`)
        if (message.ruleId?.startsWith('@tanstack/query/')) add(message.ruleId.slice('@tanstack/query/'.length))
      }
    }
  } else {
    const report = JSON.parse(raw.slice(raw.indexOf('{')))
    for (const diagnostic of report.diagnostics) {
      if (diagnostic.category !== 'plugin') {
        throw new Error(`Biome reported ${diagnostic.category}: ${diagnostic.message}`)
      }
      const match = /^@tanstack\/query\/([a-z-]+): /.exec(diagnostic.message)
      if (match) add(match[1])
    }
  }
  return counts
}

function measure(testCase) {
  log(`  ${testCase.label}: warm-up + ${RUNS} runs`)
  const warmup = runOnce(testCase)
  const times = []
  for (let i = 0; i < RUNS; i++) times.push(runOnce(testCase).ms)
  times.sort((a, b) => a - b)
  return {
    label: testCase.label,
    tool: testCase.tool,
    medianMs: times[Math.floor(times.length / 2)],
    minMs: times[0],
    findings: warmup.findings,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)} s`
}

function renderMarkdown(report) {
  const { environment: env, corpus, results } = report
  // Baseline: the fastest ESLint run that actually lints with the plugin.
  const fastestEslint = Math.min(...results.filter((r) => r.id.startsWith('eslint-untyped')).map((r) => r.medianMs))
  const lines = [
    `Corpus: ${corpus.files} generated files, ${corpus.lines.toLocaleString('en-US')} lines (seed ${corpus.seed}); ${RUNS} runs after 1 warm-up.`,
    `Machine: ${env.cpu} (${env.cores} threads), ${env.os}, Node ${env.node}.`,
    `Versions: Biome ${env.biome}, ESLint ${env.eslint}, ${pkg.upstream.package} ${pkg.upstream.version}, typescript-eslint ${TOOLCHAIN['typescript-eslint']}, TypeScript ${TOOLCHAIN.typescript}.`,
    '',
    '| Configuration | Median | Min | Speed vs. ESLint + plugin (untyped, fastest) |',
    '| ------------- | -----: | --: | -------------------------------------------: |',
    ...results.map(
      (r) =>
        `| ${r.label} | ${formatSeconds(r.medianMs)} | ${formatSeconds(r.minMs)} | ${(fastestEslint / r.medianMs).toFixed(1)}× |`,
    ),
    '',
    '| Rule | Injected | ESLint (typed) | ESLint (untyped) | Biome (`index.grit`) |',
    '| ---- | -------: | -------------: | ---------------: | -------------------: |',
  ]
  const typed = results.find((r) => r.id === 'eslint-typed')
  const untyped = results.find((r) => r.id === 'eslint-untyped')
  const biome = results.find((r) => r.id === 'biome-index')
  for (const rule of VIOLATIONS) {
    lines.push(
      `| \`${rule}\` | ${corpus.injected[rule]} | ${typed ? (typed.findings[rule] ?? 0) : 'n/a'} | ${untyped.findings[rule] ?? 0} | ${biome.findings[rule] ?? 0} |`,
    )
  }
  return lines.join('\n')
}

function main() {
  installToolchain()
  const { injected, lines } = generateCorpus()
  writeConfigs()

  const threads = availableParallelism()
  const cases = [
    { id: 'eslint-parse', ...eslintCase('ESLint, parser only (no rules)', 'eslint.parse-only.config.mjs') },
    { id: 'eslint-untyped', ...eslintCase('ESLint + plugin, untyped', 'eslint.untyped.config.mjs') },
    {
      id: 'eslint-untyped-mt',
      ...eslintCase('ESLint + plugin, untyped, `--concurrency=auto`', 'eslint.untyped.config.mjs', 'auto'),
    },
    ...(options['no-typed']
      ? []
      : [
          { id: 'eslint-typed', ...eslintCase('ESLint + plugin, typed (`projectService`)', 'eslint.typed.config.mjs') },
          {
            id: 'eslint-typed-mt',
            ...eslintCase('ESLint + plugin, typed, `--concurrency=auto`', 'eslint.typed.config.mjs', 'auto'),
          },
        ]),
    { id: 'biome-none', ...biomeCase('Biome, no plugins', 'none') },
    { id: 'biome-index', ...biomeCase('Biome + `index.grit`', 'index') },
    { id: 'biome-standalone', ...biomeCase('Biome + 7 standalone rule files', 'standalone') },
  ]

  log(`Benchmarking ${FILES} files (${lines} lines) on ${threads} threads ...`)
  const results = cases.map((testCase) => ({ id: testCase.id, ...measure(testCase) }))

  const report = {
    environment: {
      cpu: cpus()[0]?.model ?? 'unknown CPU',
      cores: threads,
      os: `${platform()} ${release()}`,
      node: process.versions.node,
      biome: version(BIOME_BIN),
      eslint: version(ESLINT_BIN()).replace(/^v/, ''),
    },
    corpus: { files: FILES, lines, seed: SEED, injected },
    results,
  }
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderMarkdown(report)}\n`)
}

main()
