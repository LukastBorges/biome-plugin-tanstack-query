import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const RULES_DIR = join(ROOT, 'rules')
export const FIXTURES_DIR = join(ROOT, 'tests', 'fixtures')

// Resolve the CLI the same way a consumer's `npx biome` would. Setting
// BIOME_PLUGIN_TEST_BIN to another `@biomejs/biome/bin/biome` script runs the
// suite against a different Biome version. (Not `BIOME_BINARY`: Biome's own
// launcher reads that variable as the path of the native executable.)
const BIOME_BIN =
  process.env.BIOME_PLUGIN_TEST_BIN ?? join(dirname(require.resolve('@biomejs/biome/package.json')), 'bin', 'biome')

// Never forward a BIOME_BINARY from the caller's environment: pointing it at
// the JS launcher makes the launcher re-spawn itself forever.
const { BIOME_BINARY: _ignored, ...CHILD_ENV } = process.env

/** Every diagnostic message emitted by this plugin starts with this prefix. */
export const MESSAGE_PREFIX = /^@tanstack\/query\/([a-z-]+): /

export interface PluginDiagnostic {
  /** Upstream rule name, e.g. `no-rest-destructuring`. */
  rule: string
  message: string
  severity: 'error' | 'warning' | 'information' | 'hint'
  line: number
  column: number
  endLine: number
  endColumn: number
}

export interface BiomeRun {
  diagnostics: PluginDiagnostic[]
  /** Contents of the linted file after the run (differs from the input only with `write`). */
  output: string
  stderr: string
}

export interface RunOptions {
  /** Plugin file names relative to `rules/`, e.g. `['no-rest-destructuring.grit']`. */
  plugins: string[]
  /** Apply safe fixes (`--write`). */
  write?: boolean
  /** Also apply unsafe fixes (`--write --unsafe`). */
  unsafe?: boolean
  /** Where to put the file inside the temporary project. Defaults to its basename at the root. */
  path?: string
  /**
   * Limit the plugins to these globs, either through the `includes` of each
   * `plugins` entry or through an `overrides` entry.
   */
  scope?: { includes: string[]; via: 'plugin-entry' | 'override' }
}

interface JsonReport {
  diagnostics: Array<{
    severity: PluginDiagnostic['severity']
    message: string
    category?: string
    location?: {
      start: { line: number; column: number }
      end: { line: number; column: number }
    }
  }>
}

/**
 * Lints a single file with the given plugins, in an isolated temporary
 * project so this repository's `biome.json` does not interfere with the
 * result.
 */
export async function runBiome(fixturePath: string, options: RunOptions): Promise<BiomeRun> {
  const dir = await mkdtemp(join(tmpdir(), 'biome-plugin-tanstack-query-'))
  try {
    const path = options.path ?? basename(fixturePath)
    const target = join(dir, path)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(fixturePath, target)
    const plugins = options.plugins.map((plugin) => join(RULES_DIR, plugin))
    const { scope } = options
    await writeFile(
      join(dir, 'biome.json'),
      JSON.stringify(
        {
          root: true,
          vcs: { enabled: false },
          files: { ignoreUnknown: false },
          formatter: { enabled: false },
          assist: { enabled: false },
          // Built-in rules are not under test, and their fixes would leak into
          // the `--write` expectations. `preset` exists since Biome 2.5.0.
          linter: { enabled: true, rules: { preset: 'none' } },
          plugins:
            scope?.via === 'plugin-entry'
              ? plugins.map((plugin) => ({ path: plugin, includes: scope.includes }))
              : scope
                ? []
                : plugins,
          ...(scope?.via === 'override' && { overrides: [{ includes: scope.includes, plugins }] }),
        },
        null,
        2,
      ),
    )

    const args = ['lint', '--reporter=json', '--max-diagnostics=none', '--colors=off']
    if (options.write || options.unsafe) args.push('--write')
    if (options.unsafe) args.push('--unsafe')
    args.push(path)

    let stdout: string
    let stderr: string
    try {
      ;({ stdout, stderr } = await execFileAsync(process.execPath, [BIOME_BIN, ...args], {
        cwd: dir,
        env: CHILD_ENV,
        maxBuffer: 64 * 1024 * 1024,
      }))
    } catch (error) {
      // Biome exits with code 1 when it reports errors; that is expected here.
      const failure = error as { stdout?: string; stderr?: string; code?: number | string; signal?: string | null }
      if (failure.stdout === undefined) throw error
      stdout = failure.stdout
      stderr = `${failure.stderr ?? ''}\n[exit code: ${failure.code ?? 'none'}, signal: ${failure.signal ?? 'none'}]`
    }

    const report = parseReport(stdout, stderr)
    const diagnostics: PluginDiagnostic[] = []
    for (const diagnostic of report.diagnostics) {
      if (diagnostic.category !== 'plugin') {
        // Panics, plugin compilation failures, parse errors, ... are bugs in
        // this repository: surface them instead of silently dropping them.
        throw new Error(
          `Unexpected ${diagnostic.category ?? 'uncategorised'} diagnostic while linting ${basename(fixturePath)}: ${diagnostic.message}\n${stderr}`,
        )
      }
      const match = MESSAGE_PREFIX.exec(diagnostic.message)
      if (!match || !diagnostic.location) {
        throw new Error(`Plugin diagnostic without the "@tanstack/query/<rule>: " prefix: ${diagnostic.message}`)
      }
      diagnostics.push({
        rule: match[1],
        message: diagnostic.message.slice(match[0].length),
        severity: diagnostic.severity,
        line: diagnostic.location.start.line,
        column: diagnostic.location.start.column,
        endLine: diagnostic.location.end.line,
        endColumn: diagnostic.location.end.column,
      })
    }

    diagnostics.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule))
    return { diagnostics, output: await readFile(target, 'utf8'), stderr }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function parseReport(stdout: string, stderr: string): JsonReport {
  const start = stdout.indexOf('{')
  if (start === -1) {
    throw new Error(`Biome did not produce a JSON report.\nstdout:\n${stdout}\nstderr:\n${stderr}`)
  }
  try {
    return JSON.parse(stdout.slice(start)) as JsonReport
  } catch (error) {
    throw new Error(
      `Could not parse Biome's JSON report: ${(error as Error).message}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    )
  }
}
