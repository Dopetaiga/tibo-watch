import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { GithubUpdateChecker } from '../../app/adapters/updates/github'
import { WindowsUpdateInstaller } from '../../app/adapters/updates/windows-installer'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  canonicalUpdateManifest,
  installConfirmedUpdate,
  verifyUpdateManifest,
  type SignedUpdateManifest,
  type UpdateManifest,
} from '../../app/domain/update'

const keys = generateKeyPairSync('ed25519')
const bytes = new TextEncoder().encode('installer')

function envelope(version = '0.2.0'): SignedUpdateManifest {
  const payload: UpdateManifest = {
    schemaVersion: 1,
    version,
    publishedAt: '2026-08-11T00:00:00.000Z',
    asset: {
      name: 'Tibo Watch Setup 0.2.0.exe',
      url: 'https://github.com/example/tibo-watch/releases/download/v0.2.0/setup.exe',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  }
  return {
    payload,
    signature: sign(
      null,
      Buffer.from(canonicalUpdateManifest(payload)),
      keys.privateKey,
    ).toString('base64'),
  }
}

const publicKey = keys.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()

describe('signed GitHub updates', () => {
  it('accepts authentic metadata and rejects any tampering', () => {
    const signed = envelope()
    expect(verifyUpdateManifest(signed, publicKey).version).toBe('0.2.0')
    signed.payload.version = '9.9.9'
    expect(() => verifyUpdateManifest(signed, publicKey)).toThrow('签名无效')
  })

  it('matches the signed asset against the GitHub release', async () => {
    const signed = envelope()
    const fetchImpl = vi.fn(async () =>
      Response.json({
        draft: false,
        prerelease: false,
        body: JSON.stringify(signed),
        assets: [
          {
            name: signed.payload.asset.name,
            browser_download_url: signed.payload.asset.url,
          },
        ],
      }),
    ) as unknown as typeof fetch
    const checker = new GithubUpdateChecker(
      'example',
      'tibo-watch',
      '0.1.0',
      publicKey,
      fetchImpl,
    )
    await expect(checker.check()).resolves.toMatchObject({ version: '0.2.0' })
  })

  it('never downloads or launches without explicit confirmation', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const installer = { stageAndLaunch: vi.fn() }
    await expect(
      installConfirmedUpdate(envelope().payload, false, fetchImpl, installer),
    ).rejects.toThrow('明确确认')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(installer.stageAndLaunch).not.toHaveBeenCalled()
  })

  it('verifies the downloaded installer before launching it', async () => {
    const installer = { stageAndLaunch: vi.fn(async () => {}) }
    const fetchImpl = vi.fn(
      async () => new Response(bytes, { status: 200 }),
    ) as unknown as typeof fetch
    await installConfirmedUpdate(envelope().payload, true, fetchImpl, installer)
    expect(installer.stageAndLaunch).toHaveBeenCalledWith(
      'Tibo Watch Setup 0.2.0.exe',
      bytes,
    )
  })

  it('contains offline errors inside the recurring checker', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const checker = new GithubUpdateChecker(
      'example',
      'tibo-watch',
      '0.1.0',
      publicKey,
      fetchImpl,
    )
    const onError = vi.fn()
    const stop = checker.start(60_000, vi.fn(), onError)
    await vi.runOnlyPendingTimersAsync()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'offline' }),
    )
    stop()
    vi.useRealTimers()
  })

  it('stages a confirmed installer under the configured temporary root', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'tibo-watch-update-test-'),
    )
    let launched = ''
    const installer = new WindowsUpdateInstaller(root, async (target) => {
      launched = target
      return ''
    })
    await installer.stageAndLaunch('Tibo Watch Setup 0.2.0.exe', bytes)
    expect(path.relative(root, launched)).not.toMatch(/^\.\.[/\\]/)
    await expect(readFile(launched)).resolves.toEqual(Buffer.from(bytes))
  })
})
