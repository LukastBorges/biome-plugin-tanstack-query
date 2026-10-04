import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectReleaseAssets,
  NPM_PUBLISH,
  SLSA_PROVENANCE,
  verifyAttestationSubject,
} from '../scripts/release-assets.js'

const NAME = 'biome-plugin-tanstack-query'
const VERSION = '1.2.3'
const TARBALL = Buffer.from('pretend this is a gzipped tarball')
const SHA512 = createHash('sha512').update(TARBALL)
const DIGEST = SHA512.copy().digest()

function attestation(
  predicateType: string,
  overrides: { name?: string; sha512?: string; signatures?: unknown[] } = {},
) {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [
      {
        name: overrides.name ?? `pkg:npm/${NAME}@${VERSION}`,
        digest: { sha512: overrides.sha512 ?? DIGEST.toString('hex') },
      },
    ],
    predicateType,
    predicate: {},
  }
  return {
    predicateType,
    bundle: {
      mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
      verificationMaterial: { certificate: { rawBytes: 'MII...' } },
      dsseEnvelope: {
        payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
        payloadType: 'application/vnd.in-toto+json',
        signatures: overrides.signatures ?? [{ sig: 'MEUC...', keyid: '' }],
      },
    },
  }
}

function registry({
  integrity = `sha512-${DIGEST.toString('base64')}`,
  attestations = [attestation(SLSA_PROVENANCE), attestation(NPM_PUBLISH)],
} = {}) {
  return vi.fn(async (url: string) => {
    if (url.endsWith(`/${NAME}/${VERSION}`)) {
      return Response.json({ dist: { integrity, tarball: `https://registry.test/${NAME}-${VERSION}.tgz` } })
    }
    if (url.endsWith('.tgz')) return new Response(new Uint8Array(TARBALL))
    if (url.includes('/-/npm/v1/attestations/')) return Response.json({ attestations })
    return new Response('not found', { status: 404 })
  })
}

const dirs: string[] = []
const outDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-assets-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('verifyAttestationSubject', () => {
  const hex = DIGEST.toString('hex')

  it('accepts an attestation for this exact package version and digest', () => {
    expect(() => verifyAttestationSubject(attestation(SLSA_PROVENANCE), NAME, VERSION, hex)).not.toThrow()
  })

  it('rejects another digest, another version, or a missing signature', () => {
    expect(() => verifyAttestationSubject(attestation(SLSA_PROVENANCE, { sha512: 'ab' }), NAME, VERSION, hex)).toThrow(
      /digest/,
    )
    expect(() =>
      verifyAttestationSubject(attestation(SLSA_PROVENANCE, { name: `pkg:npm/${NAME}@9.9.9` }), NAME, VERSION, hex),
    ).toThrow(/no subject/)
    expect(() =>
      verifyAttestationSubject(attestation(SLSA_PROVENANCE, { signatures: [] }), NAME, VERSION, hex),
    ).toThrow(/signed DSSE envelope/)
  })
})

describe('collectReleaseAssets', () => {
  it('writes the tarball, both Sigstore bundles and the in-toto envelope', async () => {
    vi.stubGlobal('fetch', registry())
    const out = outDir()
    await collectReleaseAssets(VERSION, { name: NAME, out, registry: 'https://registry.test' })

    const base = `${NAME}-${VERSION}`
    expect(readdirSync(out).sort()).toEqual(
      [`${base}.intoto.jsonl`, `${base}.publish.sigstore.json`, `${base}.tgz`, `${base}.tgz.sigstore.json`].sort(),
    )
    expect(readFileSync(join(out, `${base}.tgz`))).toEqual(TARBALL)
    const provenance = JSON.parse(readFileSync(join(out, `${base}.tgz.sigstore.json`), 'utf8'))
    expect(provenance.dsseEnvelope.payloadType).toBe('application/vnd.in-toto+json')
    const envelope = JSON.parse(readFileSync(join(out, `${base}.intoto.jsonl`), 'utf8'))
    expect(envelope).toEqual(provenance.dsseEnvelope)
  })

  it('refuses a tarball that does not match the registry integrity', async () => {
    vi.stubGlobal('fetch', registry({ integrity: `sha512-${Buffer.alloc(64).toString('base64')}` }))
    await expect(
      collectReleaseAssets(VERSION, { name: NAME, out: outDir(), registry: 'https://registry.test' }),
    ).rejects.toThrow(/does not match the registry integrity/)
  })

  it('refuses provenance that covers another tarball', async () => {
    const forged = [attestation(SLSA_PROVENANCE, { sha512: '00' }), attestation(NPM_PUBLISH)]
    vi.stubGlobal('fetch', registry({ attestations: forged }))
    await expect(
      collectReleaseAssets(VERSION, { name: NAME, out: outDir(), registry: 'https://registry.test' }),
    ).rejects.toThrow(/digest does not match/)
  })

  it('gives up when the attestations never appear', async () => {
    vi.stubGlobal('fetch', registry({ attestations: [] }))
    await expect(
      collectReleaseAssets(VERSION, {
        name: NAME,
        out: outDir(),
        registry: 'https://registry.test',
        attempts: 2,
        delayMs: 1,
      }),
    ).rejects.toThrow(/still not available/)
  })
})
