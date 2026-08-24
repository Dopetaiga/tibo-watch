import { CodexAppServerClient } from './app-server.js'

export interface LeasedClient {
  client: CodexAppServerClient
  release(): void
}

export interface ConnectionManagerOptions {
  executable(): Promise<string | null>
  /** Close the shared child after this much idle time. */
  idleCloseMs?: number
  /** Health-check timeout used before reusing a pooled client. */
  pingTimeoutMs?: number
  /** Injectable for tests. */
  connect?(executable: string): Promise<CodexAppServerClient>
}

/**
 * Keeps one long-lived codex app-server child alive across probes, scans and
 * resumes so each operation no longer pays process cold-start. Clients are
 * handed out as leases; the child closes after idleCloseMs of zero leases.
 */
export class CodexConnectionManager {
  readonly #options: Required<Omit<ConnectionManagerOptions, 'connect'>> & {
    connect?(executable: string): Promise<CodexAppServerClient>
  }
  #client: CodexAppServerClient | null = null
  #leases = 0
  #idleTimer: NodeJS.Timeout | null = null

  constructor(options: ConnectionManagerOptions) {
    this.#options = {
      executable: options.executable,
      idleCloseMs: options.idleCloseMs ?? 60_000,
      pingTimeoutMs: options.pingTimeoutMs ?? 5_000,
      connect: options.connect,
    }
  }

  async acquire(): Promise<LeasedClient> {
    if (this.#idleTimer) {
      globalThis.clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
    const client = await this.#pooledOrNew()
    this.#leases += 1
    return {
      client,
      release: () => this.#release(),
    }
  }

  invalidate(): void {
    const client = this.#client
    this.#client = null
    client?.close()
  }

  async closeNow(): Promise<void> {
    this.invalidate()
  }

  async #pooledOrNew(): Promise<CodexAppServerClient> {
    if (this.#client && (await this.#healthy(this.#client))) return this.#client
    this.#client?.close()
    this.#client = null
    const executable = await this.#options.executable()
    const connect =
      this.#options.connect ??
      ((exe: string) => CodexAppServerClient.connect(exe))
    try {
      this.#client = await connect(executable ?? 'codex')
    } catch (error) {
      // One rebuild attempt: the previous child may have died between calls.
      this.#client = await connect(executable ?? 'codex')
      void error
    }
    return this.#client
  }

  async #healthy(client: CodexAppServerClient): Promise<boolean> {
    try {
      const transport = (
        client as unknown as {
          transport: {
            request(
              method: string,
              params?: Record<string, unknown>,
            ): Promise<unknown>
          }
        }
      ).transport
      await Promise.race([
        transport.request('account/read', { refreshToken: false }),
        new Promise((_, reject) =>
          globalThis.setTimeout(
            () => reject(new Error('ping timeout')),
            this.#options.pingTimeoutMs,
          ),
        ),
      ])
      return true
    } catch {
      return false
    }
  }

  #release(): void {
    this.#leases = Math.max(0, this.#leases - 1)
    if (this.#leases > 0 || this.#idleTimer) return
    this.#idleTimer = globalThis.setTimeout(() => {
      this.#idleTimer = null
      const client = this.#client
      this.#client = null
      client?.close()
    }, this.#options.idleCloseMs)
  }
}
