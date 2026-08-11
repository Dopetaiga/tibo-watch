import { createHash, verify } from 'node:crypto'

export interface UpdateAsset {
  name: string
  url: string
  sha256: string
}

export interface UpdateManifest {
  schemaVersion: 1
  version: string
  publishedAt: string
  asset: UpdateAsset
}

export interface SignedUpdateManifest {
  payload: UpdateManifest
  signature: string
}

export interface UpdateInstaller {
  stageAndLaunch(name: string, bytes: Uint8Array): Promise<void>
}

export function canonicalUpdateManifest(manifest: UpdateManifest): string {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
    publishedAt: manifest.publishedAt,
    asset: {
      name: manifest.asset.name,
      url: manifest.asset.url,
      sha256: manifest.asset.sha256,
    },
  })
}

export function verifyUpdateManifest(
  envelope: SignedUpdateManifest,
  publicKey: string,
): UpdateManifest {
  validateManifest(envelope.payload)
  const signature = Buffer.from(envelope.signature, 'base64')
  if (
    !signature.length ||
    !verify(
      null,
      Buffer.from(canonicalUpdateManifest(envelope.payload), 'utf8'),
      publicKey,
      signature,
    )
  ) {
    throw new Error('更新元数据签名无效')
  }
  return envelope.payload
}

export async function installConfirmedUpdate(
  manifest: UpdateManifest,
  confirmed: boolean,
  fetchImpl: typeof fetch,
  installer: UpdateInstaller,
): Promise<void> {
  if (!confirmed) throw new Error('更新必须由用户明确确认')
  const response = await fetchImpl(manifest.asset.url, {
    headers: { Accept: 'application/octet-stream' },
  })
  if (!response.ok) throw new Error(`更新下载失败：HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== manifest.asset.sha256)
    throw new Error('更新文件 SHA-256 不匹配')
  await installer.stageAndLaunch(manifest.asset.name, bytes)
}

function validateManifest(value: UpdateManifest): void {
  if (value.schemaVersion !== 1) throw new Error('不支持的更新元数据版本')
  if (!/^\d+\.\d+\.\d+$/.test(value.version)) throw new Error('更新版本号无效')
  if (!Number.isFinite(Date.parse(value.publishedAt)))
    throw new Error('更新时间无效')
  if (!/^[a-f0-9]{64}$/.test(value.asset.sha256))
    throw new Error('更新 SHA-256 无效')
  if (!/^[\w .()-]+\.exe$/i.test(value.asset.name))
    throw new Error('更新文件名无效')
  const url = new URL(value.asset.url)
  const allowedHosts = new Set([
    'github.com',
    'objects.githubusercontent.com',
    'github-releases.githubusercontent.com',
  ])
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname))
    throw new Error('更新下载地址不受信任')
}
