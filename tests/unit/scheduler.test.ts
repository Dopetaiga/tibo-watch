import { describe, expect, it, vi } from 'vitest'
import { PollScheduler } from '../../app/adapters/sources/scheduler'
import {
  SourceHttpError,
  type PostSourceAdapter,
} from '../../app/adapters/sources/types'

function adapter(
  fetchLatest: PostSourceAdapter['fetchLatest'],
): PostSourceAdapter {
  return {
    id: 'fixture',
    fetchLatest,
    testConnection: async () => ({ ok: true, message: 'ok' }),
  }
}

describe('poll scheduler', () => {
  it('starts only one recurring polling loop', async () => {
    vi.useFakeTimers()
    const fetchLatest = vi.fn(async () => ({
      posts: [],
      cursor: {},
      notModified: true,
    }))
    const scheduler = new PollScheduler({
      adapter: adapter(fetchLatest),
      jitter: () => 0.5,
    })
    scheduler.start()
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchLatest).toHaveBeenCalledTimes(1)
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(fetchLatest).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('coalesces concurrent polls and deduplicates posts', async () => {
    let resolve!: (
      value: Awaited<ReturnType<PostSourceAdapter['fetchLatest']>>,
    ) => void
    const pending = new Promise<
      Awaited<ReturnType<PostSourceAdapter['fetchLatest']>>
    >((done) => {
      resolve = done
    })
    const fetchLatest = vi.fn(() => pending)
    const onPosts = vi.fn(async () => undefined)
    const scheduler = new PollScheduler({
      adapter: adapter(fetchLatest),
      onPosts,
      jitter: () => 0.5,
    })
    const first = scheduler.pollNow()
    const second = scheduler.pollNow()
    expect(fetchLatest).toHaveBeenCalledTimes(1)
    resolve({
      posts: [
        {
          id: '1',
          url: 'u',
          author: 'thsottiaux',
          text: 't',
          createdAt: '2026-08-09T00:00:00Z',
          kind: 'original',
          parentPostId: null,
          quotedPostId: null,
        },
      ],
      cursor: {},
      notModified: false,
    })
    await Promise.all([first, second])
    await scheduler.pollNow()
    expect(onPosts).toHaveBeenCalledTimes(1)
  })

  it('backs off for 429 and recovers to the normal interval', async () => {
    const fetchLatest = vi
      .fn()
      .mockRejectedValueOnce(
        new SourceHttpError(429, 'rate limited', 20 * 60_000),
      )
      .mockResolvedValueOnce({ posts: [], cursor: {}, notModified: true })
    const scheduler = new PollScheduler({
      adapter: adapter(fetchLatest),
      jitter: () => 0.5,
    })
    expect((await scheduler.pollNow()).nextDelayMs).toBe(20 * 60_000)
    const recovered = await scheduler.pollNow()
    expect(recovered).toMatchObject({
      sourceStatus: 'healthy',
      consecutiveFailures: 0,
      nextDelayMs: 5 * 60_000,
      stale: false,
    })
  })

  it('backs off after a server error', async () => {
    const scheduler = new PollScheduler({
      adapter: adapter(async () => {
        throw new SourceHttpError(503, 'unavailable')
      }),
      jitter: () => 0.5,
    })
    expect(await scheduler.pollNow()).toMatchObject({
      sourceStatus: 'degraded',
      consecutiveFailures: 1,
      nextDelayMs: 5 * 60_000,
      stale: true,
    })
  })

  it('marks network failures offline and caps exponential backoff', async () => {
    const scheduler = new PollScheduler({
      adapter: adapter(async () => {
        throw new TypeError('network offline')
      }),
      jitter: () => 0.5,
      normalIntervalMs: 5 * 60_000,
      maximumBackoffMs: 30 * 60_000,
    })
    let state
    for (let index = 0; index < 5; index += 1) state = await scheduler.pollNow()
    expect(state).toMatchObject({
      sourceStatus: 'offline',
      nextDelayMs: 30 * 60_000,
      stale: true,
    })
  })

  it('cancels a timed out request and marks data stale', async () => {
    vi.useFakeTimers()
    const scheduler = new PollScheduler({
      adapter: adapter(
        (_cursor, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            })
          }),
      ),
      timeoutMs: 100,
      jitter: () => 0.5,
    })
    const result = scheduler.pollNow()
    await vi.advanceTimersByTimeAsync(100)
    expect(await result).toMatchObject({
      sourceStatus: 'degraded',
      stale: true,
    })
    vi.useRealTimers()
  })
})
