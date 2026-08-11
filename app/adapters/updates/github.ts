import type {
  SignedUpdateManifest,
  UpdateManifest,
} from '../../domain/update.js'
import { verifyUpdateManifest } from '../../domain/update.js'

interface GithubRelease {
  draft: boolean
  prerelease: boolean
  body: string
  assets: Array<{ name: string; browser_download_url: string }>
}

export class GithubUpdateChecker {
  readonly #endpoint: string

  constructor(
    owner: string,
    repository: string,
    readonly currentVersion: string,
    readonly publicKey: string,
    readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repository))
      throw new Error('GitHub 仓库标识无效')
    this.#endpoint = `https://api.github.com/repos/${owner}/${repository}/releases/latest`
  }

  async check(): Promise<UpdateManifest | null> {
    const response = await this.fetchImpl(this.#endpoint, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) throw new Error(`更新检查失败：HTTP ${response.status}`)
    const release = (await response.json()) as GithubRelease
    if (release.draft || release.prerelease) return null
    const envelope = JSON.parse(release.body) as SignedUpdateManifest
    const manifest = verifyUpdateManifest(envelope, this.publicKey)
    const asset = release.assets.find(
      ({ name }) => name === manifest.asset.name,
    )
    if (!asset || asset.browser_download_url !== manifest.asset.url)
      throw new Error('更新元数据与 GitHub Release 资源不一致')
    return compareVersions(manifest.version, this.currentVersion) > 0
      ? manifest
      : null
  }

  start(
    intervalMs: number,
    onAvailable: (manifest: UpdateManifest) => void,
    onError: (error: Error) => void,
  ): () => void {
    if (!Number.isFinite(intervalMs) || intervalMs < 60_000)
      throw new Error('更新检查间隔不得小于 1 分钟')
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        const available = await this.check()
        if (available && !stopped) onAvailable(available)
      } catch (error) {
        if (!stopped) onError(error as Error)
      } finally {
        if (!stopped) timer = setTimeout(run, intervalMs)
      }
    }
    void run()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}
