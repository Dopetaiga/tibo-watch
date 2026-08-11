import { describe, expect, it } from 'vitest'
import { PollScheduler } from '../../app/adapters/sources/scheduler'
import type { PostSourceAdapter } from '../../app/adapters/sources/types'
import { SourceHttpError } from '../../app/adapters/sources/types'

describe('accelerated 24 hour scheduler', () => {
  it('bounds frequency, backs off, deduplicates, and caps retained IDs', async () => {
    let now = Date.parse('2026-08-11T00:00:00.000Z')
    const end = now + 24 * 60 * 60_000
    let calls = 0
    const delivered: string[] = []
    const adapter: PostSourceAdapter = {
      id: 'accelerated-fixture',
      testConnection: async () => ({ ok: true, message: 'ok' }),
      fetchLatest: async (cursor) => {
        calls += 1
        if (calls === 20)
          throw new SourceHttpError(429, 'rate limited', 10 * 60_000)
        if (calls === 40) throw new SourceHttpError(503, 'unavailable')
        if (calls === 60) throw new TypeError('network offline')
        // Every source post is returned twice in adjacent polls, while new IDs
        // continue throughout the day so the retained dedupe window is stressed.
        const id = String(Math.floor(calls / 2))
        return {
          posts: [
            {
              id,
              url: `https://x.com/thsottiaux/status/${id}`,
              author: 'thsottiaux',
              text: `post ${id}`,
              createdAt: new Date(now).toISOString(),
              kind: 'original' as const,
              parentPostId: null,
              quotedPostId: null,
            },
          ],
          cursor,
          notModified: false,
        }
      },
    }
    const scheduler = new PollScheduler({
      adapter,
      normalIntervalMs: 5 * 60_000,
      activeIntervalMs: 60_000,
      activeDurationMs: 60 * 60_000,
      maximumBackoffMs: 30 * 60_000,
      maximumSeenPostIds: 20,
      jitter: () => 0.5,
      now: () => now,
      onPosts: async (posts) =>
        void delivered.push(...posts.map(({ id }) => id)),
    })
    scheduler.activate()
    let maximumDelay = 0
    while (now < end) {
      const state = await scheduler.pollNow()
      maximumDelay = Math.max(maximumDelay, state.nextDelayMs)
      now += state.nextDelayMs
    }
    const diagnostics = scheduler.diagnostics()
    expect(calls).toBeGreaterThan(250)
    expect(calls).toBeLessThan(340)
    expect(maximumDelay).toBeLessThanOrEqual(30 * 60_000)
    expect(diagnostics.seenPostIds).toBeLessThanOrEqual(20)
    expect(new Set(delivered).size).toBe(delivered.length)
    expect(diagnostics.inFlight).toBe(false)
  })
})
