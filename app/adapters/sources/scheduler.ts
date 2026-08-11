import type { PostSourceAdapter, SourceCursor, SourcePost } from './types.js'
import { SourceHttpError } from './types.js'

export interface SchedulerState {
  sourceStatus: 'healthy' | 'degraded' | 'offline'
  consecutiveFailures: number
  nextDelayMs: number
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  stale: boolean
}

export interface SchedulerOptions {
  adapter: PostSourceAdapter
  timeoutMs?: number
  normalIntervalMs?: number
  activeIntervalMs?: number
  activeDurationMs?: number
  maximumBackoffMs?: number
  jitter?: () => number
  now?: () => number
  onPosts?: (posts: SourcePost[]) => Promise<void>
  maximumSeenPostIds?: number
}

export class PollScheduler {
  readonly #options: Required<Omit<SchedulerOptions, 'adapter' | 'onPosts'>> &
    Pick<SchedulerOptions, 'adapter' | 'onPosts'>
  #cursor: SourceCursor = {}
  #inFlight: Promise<SchedulerState> | null = null
  #activeUntil = 0
  #seenPostIds = new Set<string>()
  #seenPostOrder: string[] = []
  #state: SchedulerState
  #timer: ReturnType<typeof setTimeout> | null = null
  #running = false

  constructor(options: SchedulerOptions) {
    this.#options = {
      adapter: options.adapter,
      onPosts: options.onPosts,
      timeoutMs: options.timeoutMs ?? 30_000,
      normalIntervalMs: options.normalIntervalMs ?? 5 * 60_000,
      activeIntervalMs: options.activeIntervalMs ?? 60_000,
      activeDurationMs: options.activeDurationMs ?? 60 * 60_000,
      maximumBackoffMs: options.maximumBackoffMs ?? 30 * 60_000,
      jitter: options.jitter ?? Math.random,
      now: options.now ?? Date.now,
      maximumSeenPostIds: options.maximumSeenPostIds ?? 10_000,
    }
    this.#state = {
      sourceStatus: 'degraded',
      consecutiveFailures: 0,
      nextDelayMs: this.#options.normalIntervalMs,
      lastCheckedAt: null,
      lastSuccessAt: null,
      stale: true,
    }
  }

  activate(): void {
    this.#activeUntil = this.#options.now() + this.#options.activeDurationMs
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#schedule(0)
  }

  stop(): void {
    this.#running = false
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  pollNow(): Promise<SchedulerState> {
    if (this.#inFlight) return this.#inFlight
    this.#inFlight = this.#poll().finally(() => {
      this.#inFlight = null
    })
    return this.#inFlight
  }

  snapshot(): SchedulerState {
    return { ...this.#state }
  }

  diagnostics(): { seenPostIds: number; inFlight: boolean; running: boolean } {
    return {
      seenPostIds: this.#seenPostIds.size,
      inFlight: this.#inFlight !== null,
      running: this.#running,
    }
  }

  async #poll(): Promise<SchedulerState> {
    const checkedAt = new Date(this.#options.now()).toISOString()
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new Error('数据源请求超时')),
      this.#options.timeoutMs,
    )
    try {
      const result = await this.#options.adapter.fetchLatest(
        this.#cursor,
        controller.signal,
      )
      this.#cursor = result.cursor
      const newPosts = result.posts.filter(
        ({ id }) => !this.#seenPostIds.has(id),
      )
      const newIds = newPosts.map(({ id }) => id)
      newIds.forEach((id) => {
        this.#seenPostIds.add(id)
        this.#seenPostOrder.push(id)
      })
      while (this.#seenPostOrder.length > this.#options.maximumSeenPostIds) {
        const oldest = this.#seenPostOrder.shift()
        if (oldest) this.#seenPostIds.delete(oldest)
      }
      if (newPosts.length) await this.#options.onPosts?.(newPosts)
      const baseDelay =
        this.#options.now() < this.#activeUntil
          ? this.#options.activeIntervalMs
          : this.#options.normalIntervalMs
      this.#state = {
        sourceStatus: 'healthy',
        consecutiveFailures: 0,
        nextDelayMs: withJitter(baseDelay, this.#options.jitter),
        lastCheckedAt: checkedAt,
        lastSuccessAt: checkedAt,
        stale: false,
      }
    } catch (error) {
      const failures = this.#state.consecutiveFailures + 1
      const retryAfter =
        error instanceof SourceHttpError ? error.retryAfterMs : null
      const exponential = Math.min(
        this.#options.normalIntervalMs * 2 ** (failures - 1),
        this.#options.maximumBackoffMs,
      )
      this.#state = {
        ...this.#state,
        sourceStatus: isOffline(error) ? 'offline' : 'degraded',
        consecutiveFailures: failures,
        nextDelayMs: withJitter(
          Math.min(
            Math.max(exponential, retryAfter ?? 0),
            this.#options.maximumBackoffMs,
          ),
          this.#options.jitter,
        ),
        lastCheckedAt: checkedAt,
        stale: true,
      }
    } finally {
      clearTimeout(timeout)
    }
    return this.snapshot()
  }

  #schedule(delayMs: number): void {
    this.#timer = setTimeout(() => {
      void this.pollNow().then((state) => {
        if (this.#running) this.#schedule(state.nextDelayMs)
      })
    }, delayMs)
  }
}

function withJitter(value: number, random: () => number): number {
  return Math.round(value * (0.9 + random() * 0.2))
}

function isOffline(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && /offline|network|ENOTFOUND/i.test(error.message))
  )
}
