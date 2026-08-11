import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface JsonRpcTransport {
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>
  notify(method: string, params?: Record<string, unknown>): void
  close(): void
}

export interface CodexThreadSummary {
  id: string
  name: string | null
  cwd: string | null
  updatedAt: number | null
  status: { type: string; activeFlags?: string[] }
}

export interface CodexRateLimitSnapshot {
  usedPercent: number | null
  resetsAt: number | null
  windowDurationMins: number | null
  availableResetCredits: number | null
}

export class CodexAppServerClient {
  constructor(readonly transport: JsonRpcTransport) {}

  static async connect(): Promise<CodexAppServerClient> {
    const transport = new StdioJsonRpcTransport()
    const client = new CodexAppServerClient(transport)
    await client.initialize()
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
        primary?: {
          usedPercent?: number
          resetsAt?: number
          windowDurationMins?: number
        }
      }
      rateLimitResetCredits?: { availableCount?: number } | null
    }>('account/rateLimits/read')
    const primary = result.rateLimits?.primary
    return {
      usedPercent: primary?.usedPercent ?? null,
      resetsAt: primary?.resetsAt ?? null,
      windowDurationMins: primary?.windowDurationMins ?? null,
      availableResetCredits:
        result.rateLimitResetCredits?.availableCount ?? null,
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

  async resumeThread(threadId: string): Promise<{ turnId: string }> {
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
            text: '从上次中断处继续。先检查当前工作区和任务状态，避免重复已经完成的步骤；保持原有权限边界。',
          },
        ],
      },
    )
    if (!result.turn?.id) throw new Error('Codex 未返回新的 turn ID')
    return { turnId: result.turn.id }
  }

  close(): void {
    this.transport.close()
  }
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
  #id = 0

  constructor() {
    this.#child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    createInterface({ input: this.#child.stdout }).on('line', (line) =>
      this.#onLine(line),
    )
    this.#child.once('error', (error) => this.#failAll(error))
    this.#child.once('exit', (code) =>
      this.#failAll(
        new Error(`Codex App Server 已退出（code=${code ?? 'unknown'}）`),
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
  close(): void {
    this.#child.kill()
  }
  #write(value: unknown): void {
    this.#child.stdin.write(`${JSON.stringify(value)}\n`, 'utf8')
  }
  #onLine(line: string): void {
    let value: { id?: number; result?: unknown; error?: { message?: string } }
    try {
      value = JSON.parse(line) as typeof value
    } catch {
      return
    }
    if (typeof value.id !== 'number') return
    const pending = this.#pending.get(value.id)
    if (!pending) return
    clearTimeout(pending.timer)
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
