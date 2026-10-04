#!/usr/bin/env node
// Collects the signed artifacts of a published version as GitHub release assets.
//
// npm signs every release published from release.yml: a Sigstore-signed SLSA
// provenance attestation (built by GitHub Actions via OIDC) and npm's own
// publish attestation. They live on the npm registry; this script copies them,
// together with the exact tarball they cover, next to the GitHub release, so
// the release can be verified without npm and the OpenSSF Scorecard
// "Signed-Releases" check can see them:
//
//   dist/<name>-<version>.tgz                    the published tarball
//   dist/<name>-<version>.tgz.sigstore.json      SLSA provenance (Sigstore bundle)
//   dist/<name>-<version>.intoto.jsonl           SLSA provenance (DSSE envelope)
//   dist/<name>-<version>.publish.sigstore.json  npm publish attestation (Sigstore bundle)
//
// Before writing anything it checks that the tarball matches the registry's
// sha512 integrity and that both attestations name this package version and
// that exact digest.
//
// Usage: node scripts/release-assets.js <version> [--out dist]
// Run by semantic-release (publishCmd, after @semantic-release/npm published)
// and by .github/workflows/release-assets.yml for existing releases.
// Logs go to stderr: semantic-release parses publishCmd's stdout.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { encodePackageName, fetchWithRetry, NPM_REGISTRY } from './check-upstream.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SLSA_PROVENANCE = 'https://slsa.dev/provenance/v1'
export const NPM_PUBLISH = 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1'

const log = (message) => process.stderr.write(`${message}\n`)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * Retries `load` until it returns a value: a freshly published version and its
 * attestations can take a little while to appear on the registry.
 * @template T
 * @param {string} what
 * @param {() => Promise<T | undefined>} load
 * @returns {Promise<T>}
 */
async function eventually(what, load, { attempts = 20, delayMs = 10_000 } = {}) {
  // (`undefined` options fall back to the defaults.)
  for (let attempt = 1; ; attempt++) {
    const value = await load()
    if (value !== undefined) return value
    if (attempt >= attempts) throw new Error(`${what} is still not available on the registry`)
    log(`${what} not available yet, retrying in ${delayMs / 1000}s (${attempt}/${attempts})`)
    await sleep(delayMs)
  }
}

/** @param {string} url */
async function getJson(url) {
  const response = await fetchWithRetry(url, { headers: { accept: 'application/json' } })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  return response.json()
}

/**
 * Checks that an attestation bundle covers exactly `name@version` with `sha512Hex`.
 * @param {any} attestation
 * @param {string} name
 * @param {string} version
 * @param {string} sha512Hex
 */
export function verifyAttestationSubject(attestation, name, version, sha512Hex) {
  const envelope = attestation?.bundle?.dsseEnvelope
  if (!envelope?.payload || !envelope.signatures?.length) {
    throw new Error(`${attestation?.predicateType}: missing signed DSSE envelope`)
  }
  const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'))
  const expected = `pkg:npm/${name}@${version}`
  const subject = statement.subject?.find((entry) => entry.name === expected)
  if (!subject) throw new Error(`${attestation.predicateType}: no subject named ${expected}`)
  if (subject.digest?.sha512 !== sha512Hex) {
    throw new Error(`${attestation.predicateType}: subject digest does not match the published tarball`)
  }
  if (statement.predicateType !== attestation.predicateType) {
    throw new Error(`${attestation.predicateType}: statement predicate type is ${statement.predicateType}`)
  }
}

/**
 * @param {string} version
 * @param {{ out?: string, registry?: string, name?: string, attempts?: number, delayMs?: number }} [options]
 */
export async function collectReleaseAssets(version, options = {}) {
  const name = options.name ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
  const registry = options.registry ?? NPM_REGISTRY
  const out = resolve(options.out ?? join(ROOT, 'dist'))
  const retry = { attempts: options.attempts, delayMs: options.delayMs }

  const manifest = await eventually(
    `${name}@${version}`,
    () => getJson(`${registry}/${encodePackageName(name)}/${version}`),
    retry,
  )
  const integrity = manifest.dist?.integrity ?? ''
  if (!integrity.startsWith('sha512-')) throw new Error(`${name}@${version} has no sha512 integrity`)

  const response = await fetchWithRetry(manifest.dist.tarball)
  if (!response.ok) throw new Error(`downloading ${manifest.dist.tarball} failed with ${response.status}`)
  const tarball = Buffer.from(await response.arrayBuffer())
  const digest = createHash('sha512').update(tarball).digest()
  if (`sha512-${digest.toString('base64')}` !== integrity) {
    throw new Error(`${name}@${version}: tarball does not match the registry integrity ${integrity}`)
  }
  const sha512Hex = digest.toString('hex')

  const attestations = await eventually(
    `attestations for ${name}@${version}`,
    async () => {
      const body = await getJson(`${registry}/-/npm/v1/attestations/${encodePackageName(name)}@${version}`)
      const list = body?.attestations ?? []
      const provenance = list.find((entry) => entry.predicateType === SLSA_PROVENANCE)
      const publish = list.find((entry) => entry.predicateType === NPM_PUBLISH)
      return provenance && publish ? { provenance, publish } : undefined
    },
    retry,
  )
  verifyAttestationSubject(attestations.provenance, name, version, sha512Hex)
  verifyAttestationSubject(attestations.publish, name, version, sha512Hex)

  const base = `${name.replace(/^@/, '').replace('/', '-')}-${version}`
  const files = {
    [`${base}.tgz`]: tarball,
    [`${base}.tgz.sigstore.json`]: `${JSON.stringify(attestations.provenance.bundle)}\n`,
    [`${base}.intoto.jsonl`]: `${JSON.stringify(attestations.provenance.bundle.dsseEnvelope)}\n`,
    [`${base}.publish.sigstore.json`]: `${JSON.stringify(attestations.publish.bundle)}\n`,
  }
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(out, file), content)
    log(`wrote ${join(out, file)}`)
  }
  return Object.keys(files).map((file) => join(out, file))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } })
  if (positionals.length !== 1) {
    log('usage: node scripts/release-assets.js <version> [--out dist]')
    process.exit(1)
  }
  collectReleaseAssets(positionals[0], { out: values.out }).catch((error) => {
    log(error.message)
    process.exit(1)
  })
}
