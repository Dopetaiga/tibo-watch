import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface JsonRpcTransport {
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>
  notify(method: string, params?: Record<string, unknown>): void
  /** Subscribe to server-initiated notifications; returns an unsubscribe. */
  onNotification?(
    handler: (method: string, params: unknown) => void,
  ): () => void
  close(): void
}

export interface CodexThreadSummary {
  id: string
  name: string | null
  cwd: string | null
  updatedAt: number | null
  status: { type: string; activeFlags?: string[] }
}

export interface CodexUsageSnapshot {
  lifetimeTokens: number | null
  dailyUsageBuckets: Array<{ startDate: string; tokens: number }>
}

export interface CodexWindowSnapshot {
  usedPercent: number | null
  resetsAt: number | null
  windowDurationMins: number | null
}

export interface CodexRateLimitSnapshot {
  /** Legacy primary-window fields (5h rolling window since 2026-08). */
  usedPercent: number | null
  resetsAt: number | null
  windowDurationMins: number | null
  secondary: CodexWindowSnapshot | null
  creditsBalance: string | null
  unlimited: boolean | null
  spendControlReached: boolean | null
  planType: string | null
  availableResetCredits: number | null
  resetCredits: CodexResetCredit[] | null
}

export interface CodexResetCredit {
  id: string
  grantedAt: number
  expiresAt: number | null
  status: 'available' | 'redeeming' | 'redeemed' | 'unknown'
  resetType: 'codexRateLimits' | 'unknown'
  title: string | null
  description: string | null
}

export class CodexAppServerClient {
  constructor(readonly transport: JsonRpcTransport) {}

  static async connect(
    configuredExecutable?: string | null,
  ): Promise<CodexAppServerClient> {
    const executable = await resolveCodexExecutable(configuredExecutable)
    const transport = new StdioJsonRpcTransport(executable)
    const client = new CodexAppServerClient(transport)
    try {
      await client.initialize()
    } catch (error) {
      // Do not leak the spawned child when the handshake fails.
      transport.close()
      throw error
    }
    return client
  }

  async initialize(): Promise<void> {
    await this.transport.request('initialize', {
      clientInfo: { name: 'tibo_watch', title: 'Tibo Watch', version: '0.2.0' },
    })
    this.transport.notify('initialized')
  }

  async account(): Promise<{
    authenticated: boolean
    accountType: string | null
    requiresOpenaiAuth: boolean
  }> {
    const result = await this.transport.request<{
      account: { type?: string } | null
      requiresOpenaiAuth?: boolean
    }>('account/read', { refreshToken: false })
    return {
      authenticated: Boolean(result.account),
      accountType: result.account?.type ?? null,
      requiresOpenaiAuth: result.requiresOpenaiAuth ?? false,
    }
  }

  async rateLimits(): Promise<CodexRateLimitSnapshot> {
    const result = await this.transport.request<{
      rateLimits?: {
        planType?: string
        spendControlReached?: boolean
        credits?: {
          unlimited?: boolean
          balance?: string | null
        } | null
        primary?: {
          usedPercent?: number
          resetsAt?: number
          windowDurationMins?: number
        }
        secondary?: {
          usedPercent?: number
          resetsAt?: number
          windowDurationMins?: number
        } | null
      }
      rateLimitResetCredits?: {
        availableCount?: number
        credits?: Array<{
          id?: string
          grantedAt?: number
          expiresAt?: number | null
          status?: string
          resetType?: string
          title?: string | null
          description?: string | null
        }> | null
      } | null
    }>('account/rateLimits/read')
    const envelope = result.rateLimits ?? {}
    const primary = envelope.primary
    const secondary = envelope.secondary ?? null
    const windowOf = (
      source:
        | {
            usedPercent?: number
            resetsAt?: number
            windowDurationMins?: number
          }
        | null
        | undefined,
    ): CodexWindowSnapshot => ({
      usedPercent:
        typeof source?.usedPercent === 'number' ? source.usedPercent : null,
      resetsAt: toMilliseconds(source?.resetsAt),
      windowDurationMins:
        typeof source?.windowDurationMins === 'number'
          ? source.windowDurationMins
          : null,
    })
    return {
      usedPercent: primary?.usedPercent ?? null,
      resetsAt: toMilliseconds(primary?.resetsAt),
      windowDurationMins: primary?.windowDurationMins ?? null,
      secondary: secondary ? windowOf(secondary) : null,
      creditsBalance:
        typeof envelope.credits?.balance === 'string'
          ? envelope.credits.balance
          : null,
      unlimited:
        typeof envelope.credits?.unlimited === 'boolean'
          ? envelope.credits.unlimited
          : null,
      spendControlReached:
        typeof envelope.spendControlReached === 'boolean'
          ? envelope.spendControlReached
          : null,
      planType:
        typeof envelope.planType === 'string' ? envelope.planType : null,
      availableResetCredits:
        result.rateLimitResetCredits?.availableCount ?? null,
      resetCredits:
        result.rateLimitResetCredits?.credits
          ?.filter(
            (credit) =>
              typeof credit.id === 'string' &&
              typeof credit.grantedAt === 'number',
          )
          .map((credit) => ({
            id: credit.id as string,
            grantedAt: toMilliseconds(credit.grantedAt) as number,
            expiresAt: toMilliseconds(credit.expiresAt),
            status: ['available', 'redeeming', 'redeemed'].includes(
              credit.status ?? '',
            )
              ? (credit.status as 'available' | 'redeeming' | 'redeemed')
              : 'unknown',
            resetType:
              credit.resetType === 'codexRateLimits'
                ? 'codexRateLimits'
                : 'unknown',
            title: typeof credit.title === 'string' ? credit.title : null,
            description:
              typeof credit.description === 'string'
                ? credit.description
                : null,
          })) ?? null,
    }
  }

  async usage(): Promise<CodexUsageSnapshot> {
    const result = await this.transport.request<{
      summary?: { lifetimeTokens?: number }
      dailyUsageBuckets?: Array<{ startDate?: string; tokens?: number }>
    }>('account/usage/read')
    return {
      lifetimeTokens:
        typeof result.summary?.lifetimeTokens === 'number'
          ? result.summary.lifetimeTokens
          : null,
      dailyUsageBuckets: (result.dailyUsageBuckets ?? [])
        .filter(
          (bucket) =>
            typeof bucket.startDate === 'string' &&
            typeof bucket.tokens === 'number',
        )
        .map((bucket) => ({
          startDate: bucket.startDate as string,
          tokens: bucket.tokens as number,
        })),
    }
  }

  async threads(limit = 50): Promise<CodexThreadSummary[]> {
    const result = await this.transport.request<{ data?: unknown[] }>(
      'thread/list',
      { limit, sortKey: 'updated_at', sortDirection: 'desc' },
    )
    return (result.data ?? [])
      .map(normalizeThread)
      .filter((value): value is CodexThreadSummary => Boolean(value))
  }

  async resumeThread(
    threadId: string,
    instruction = '从上次中断处继续。先检查当前工作区和任务状态，避免重复已经完成的步骤；保持原有权限边界。',
  ): Promise<{ turnId: string }> {
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(threadId))
      throw new Error('Codex 线程 ID 无效')
    const read = await this.transport.request<{
      thread?: { status?: { type?: string } }
    }>('thread/read', { threadId, includeTurns: false })
    if (read.thread?.status?.type === 'active')
      throw new Error('线程正在运行，Tibo Watch 不会干预或追加恢复指令')
    await this.transport.request('thread/resume', { threadId })
    const result = await this.transport.request<{ turn?: { id?: string } }>(
      'turn/start',
      {
        threadId,
        input: [
          {
            type: 'text',
            text: instruction,
          },
        ],
      },
    )
    if (!result.turn?.id) throw new Error('Codex 未返回新的 turn ID')
    return { turnId: result.turn.id }
  }

  async waitForTurnCompletion(
    threadId: string,
    turnId: string,
    options: {
      timeoutMs?: number
      pollIntervalMs?: number
      onStatus?: (status: { type: string; activeFlags?: string[] }) => void
    } = {},
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 10 * 60_000
    const pollIntervalMs = options.pollIntervalMs ?? 1_000
    const deadline = Date.now() + timeoutMs

    const pollFinished = async (): Promise<boolean> => {
      const read = await this.transport.request<{
        thread?: {
          status?: { type?: string; activeFlags?: string[] }
        }
      }>('thread/read', { threadId, includeTurns: false })
      const type = read.thread?.status?.type
      options.onStatus?.({
        type: typeof type === 'string' ? type : 'unknown',
        activeFlags: Array.isArray(read.thread?.status?.activeFlags)
          ? (read.thread?.status?.activeFlags as string[])
          : undefined,
      })
      if (!type || type === 'active' || type === 'notLoaded') return false
      if (/failed|error|cancelled|canceled|interrupted/i.test(type))
        throw new Error(`Codex turn failed: ${turnId} (${type})`)
      return true
    }

    // Server pushes turn/thread lifecycle notifications; use them to skip
    // sleep intervals instead of relying purely on the 1s poll cadence.
    let resolvePush: (() => void) | null = null
    let pushFailure: Error | null = null
    const armPush = (): Promise<'push'> =>
      new Promise((resolve) => {
        resolvePush = () => resolve('push')
      })
    let notified = armPush()
    const unsubscribe =
      this.transport.onNotification?.((method, params) => {
        const payload = (params ?? {}) as {
          threadId?: string
          turnId?: string
          status?: { type?: string } | string
        }
        if (/^turn\//.test(method)) {
          if (payload.threadId !== threadId || payload.turnId !== turnId) return
          if (/turn\/(failed|error)/i.test(method))
            pushFailure = new Error(`Codex turn failed: ${turnId}`)
          if (/turn\/(completed|failed|error)/i.test(method)) resolvePush?.()
          return
        }
        if (
          method === 'thread/status/changed' &&
          payload.threadId === threadId
        ) {
          const status = payload.status
          const type =
            typeof status === 'string'
              ? status
              : (status as { type?: string } | undefined)?.type
          if (typeof type === 'string' && type !== 'active') resolvePush?.()
        }
      }) ?? null

    try {
      while (Date.now() < deadline) {
        if (await pollFinished()) return
        const remaining = Math.max(0, deadline - Date.now())
        if (remaining === 0) break
        const how = await Promise.race([
          notified,
          new Promise<'tick'>((resolve) =>
            globalThis.setTimeout(resolve, Math.min(pollIntervalMs, remaining)),
          ).then(() => 'tick' as const),
        ])
        if (how === 'push') {
          notified = armPush()
          if (pushFailure) throw pushFailure
          if (await pollFinished()) return
        }
      }
      // Authoritative final check so a slow-but-finished turn is not misread.
      if (await pollFinished()) return
      throw new Error(`Codex turn timed out: ${turnId}`)
    } finally {
      unsubscribe?.()
    }
  }

  /** Best-effort short summary of the newest assistant text in the turn. */
  async turnSummary(
    threadId: string,
    turnId: string,
    maximumChars = 200,
  ): Promise<string | null> {
    try {
      const result = await this.transport.request<{
        data?: Array<{
          id?: string
          items?: Array<{ type?: string; text?: string }>
        }>
      }>('thread/turns/list', { threadId, includeItems: true })
      const turns = result.data ?? []
      const turn = turns.find((entry) => entry.id === turnId) ?? turns.at(-1)
      if (!turn) return null
      const texts = (turn.items ?? [])
        .filter((item) => item.type === 'assistantMessage' || item.text)
        .map((item) => item.text ?? '')
        .filter((text) => text.trim().length > 0)
      const joined = texts.join('\n').trim()
      return joined ? joined.slice(0, maximumChars) : null
    } catch {
      return null
    }
  }

  close(): void {
    this.transport.close()
  }
}

/**
 * Codex has shipped epoch values in both seconds and milliseconds across
 * versions. Normalize once at the adapter boundary so the rest of the app
 * can assume milliseconds: values below 1e11 cannot be a plausible ms epoch.
 */
function toMilliseconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value < 10_000_000_000 ? value * 1_000 : value
}

class StdioJsonRpcTransport implements JsonRpcTransport {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: NodeJS.Timeout
    }
  >()
  readonly #notificationHandlers = new Set<
    (method: string, params: unknown) => void
  >()
  #id = 0
  #stderr = ''

  constructor(executable: string) {
    const windowsScript =
      process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)
    const command = windowsScript ? 'cmd.exe' : executable
    const args = windowsScript
      ? [
          '/d',
          '/s',
          '/c',
          'call "%TIBO_CODEX_EXECUTABLE%" app-server --listen stdio://',
        ]
      : ['app-server', '--listen', 'stdio://']
    const env = codexProcessEnvironment(executable, windowsScript)
    this.#child = spawn(command, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })
    createInterface({ input: this.#child.stdout }).on('line', (line) =>
      this.#onLine(line),
    )
    // A dead child can make stdin writes emit EPIPE asynchronously; surface
    // failures through the exit handler instead of an unhandled stream error.
    this.#child.stdin.on('error', () => {})
    this.#child.once('error', (error) => this.#failAll(error))
    this.#child.stderr.on('data', (chunk: Buffer | string) => {
      this.#stderr = `${this.#stderr}${chunk.toString()}`.slice(-4_000)
    })
    this.#child.once('exit', (code) =>
      this.#failAll(
        new Error(
          `Codex App Server 已退出（code=${code ?? 'unknown'}）${this.#stderr.trim() ? `：${this.#stderr.trim()}` : ''}`,
        ),
      ),
    )
  }

  request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = ++this.#id
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`Codex App Server 请求超时：${method}`))
      }, 15_000)
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      this.#write({ id, method, ...(params ? { params } : {}) })
    })
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.#write({ method, ...(params ? { params } : {}) })
  }
  onNotification(
    handler: (method: string, params: unknown) => void,
  ): () => void {
    this.#notificationHandlers.add(handler)
    return () => this.#notificationHandlers.delete(handler)
  }
  close(): void {
    const pid = this.#child.pid
    // A cmd.exe wrapper would otherwise survive kill() and leave an orphaned
    // Codex process behind.
    if (process.platform === 'win32' && pid) {
      try {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } catch {
        this.#child.kill()
      }
    } else this.#child.kill()
  }
  #write(value: unknown): void {
    this.#child.stdin.write(`${JSON.stringify(value)}\n`, 'utf8')
  }
  #onLine(line: string): void {
    let value: {
      id?: number
      method?: string
      params?: unknown
      result?: unknown
      error?: { message?: string }
    }
    try {
      value = JSON.parse(line) as typeof value
    } catch {
      return
    }
    if (typeof value.id !== 'number') {
      // Server-initiated notification/request (no id): fan out to subscribers.
      if (value.method)
        for (const handler of this.#notificationHandlers)
          handler(value.method, value.params ?? null)
      return
    }
    const pending = this.#pending.get(value.id)
    if (!pending) return
    globalThis.clearTimeout(pending.timer)
    this.#pending.delete(value.id)
    if (value.error)
      pending.reject(
        new Error(value.error.message ?? 'Codex App Server 请求失败'),
      )
    else pending.resolve(value.result)
  }
  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

function codexProcessEnvironment(
  executable: string,
  windowsScript = false,
): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (process.platform === 'win32' && !env.CODEX_HOME) {
    const userProfile =
      env.USERPROFILE ||
      (env.HOMEDRIVE && env.HOMEPATH
        ? `${env.HOMEDRIVE}${env.HOMEPATH}`
        : env.APPDATA
          ? path.dirname(env.APPDATA)
          : null)
    if (userProfile) env.CODEX_HOME = path.join(userProfile, '.codex')
  }
  if (windowsScript) env.TIBO_CODEX_EXECUTABLE = executable
  return env
}

export async function resolveCodexExecutable(
  configured?: string | null,
): Promise<string> {
  if (
    configured &&
    existsSync(configured) &&
    !isPackagedWindowsAppPath(configured)
  )
    return configured
  if (process.platform !== 'win32') return 'codex'
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    const managedExecutable = path.join(
      localAppData,
      'TiboWatch',
      'codex-cli',
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
      'codex.exe',
    )
    if (existsSync(managedExecutable)) return managedExecutable
  }
  const appData = process.env.APPDATA
  if (appData) {
    const npmShim = path.join(appData, 'npm', 'codex.cmd')
    if (existsSync(npmShim)) return npmShim
  }
  try {
    const script =
      "$command=Get-Command codex.cmd -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source; if ($command) { $command; exit 0 }; $command=Get-Command codex.exe -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*\\Program Files\\WindowsApps\\*' } | Select-Object -First 1 -ExpandProperty Source; if ($command) { $command }"
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 8_000 },
    )
    const candidate = stdout.trim()
    if (candidate && existsSync(candidate)) return candidate
  } catch {
    // Report the actionable CLI requirement below.
  }
  throw new Error(
    '检测到的 Codex 来自受保护的 Windows Desktop 安装包，第三方应用无法直接启动。请先安装独立 Codex CLI，然后重新探测。',
  )
}

function isPackagedWindowsAppPath(value: string): boolean {
  return /[\\/]Program Files[\\/]WindowsApps[\\/]/i.test(value)
}

function normalizeThread(value: unknown): CodexThreadSummary | null {
  if (!value || typeof value !== 'object') return null
  const thread = value as Record<string, unknown>
  if (typeof thread.id !== 'string') return null
  const status =
    thread.status && typeof thread.status === 'object'
      ? (thread.status as Record<string, unknown>)
      : {}
  return {
    id: thread.id,
    name: typeof thread.name === 'string' ? thread.name : null,
    cwd: typeof thread.cwd === 'string' ? thread.cwd : null,
    updatedAt: typeof thread.updatedAt === 'number' ? thread.updatedAt : null,
    status: {
      type: typeof status.type === 'string' ? status.type : 'unknown',
      activeFlags: Array.isArray(status.activeFlags)
        ? status.activeFlags.filter(
            (item): item is string => typeof item === 'string',
          )
        : undefined,
    },
  }
}
