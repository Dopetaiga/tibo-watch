import { describe, expect, it } from 'vitest'
import type { DashboardEvent, DashboardModel } from '../../app/domain/dashboard'
import {
  calendarDays,
  eventStatistics,
  selectVisiblePosts,
} from '../../app/renderer/src/dashboard-model'

type PostRow = DashboardModel['posts'][number]

function event(
  id: string,
  status: DashboardEvent['status'],
  occurredAt: string,
  type: DashboardEvent['type'] = 'forced',
): DashboardEvent {
  return { id, title: id, status, type, occurredAt, sourceUrl: '' }
}

function post(
  id: string,
  postedAt: string,
  relevance: PostRow['relevance'] = 'candidate',
): PostRow {
  return {
    id,
    sourceUrl: `https://x.com/thsottiaux/status/${id}`,
    kind: 'original',
    excerpt: `post ${id}`,
    postedAt,
    ruleMatched: relevance === 'candidate',
    aiCalled: false,
    formedEvent: false,
    relevance,
    eventType: null,
  }
}

const now = new Date('2026-08-24T04:00:00.000Z') // 12:00 Asia/Shanghai

describe('eventStatistics', () => {
  it('counts confirmed events by recency and kind in one pass', () => {
    const day = 86_400_000
    const events = [
      event('a', 'confirmed', new Date(now.getTime() - 1 * day).toISOString()),
      event(
        'b',
        'confirmed',
        new Date(now.getTime() - 5 * day).toISOString(),
        'banked',
      ),
      event(
        'c',
        'confirmed',
        new Date(now.getTime() - 20 * day).toISOString(),
        'compensation',
      ),
      event('d', 'confirmed', new Date(now.getTime() - 40 * day).toISOString()),
      event('e', 'expected', now.toISOString()),
    ]
    expect(eventStatistics(events, now)).toEqual({
      all: 4,
      last7: 2,
      last30: 3,
      forced: 2,
      compensation: 1,
      banked: 1,
    })
  })

  it('returns zeros for empty input', () => {
    expect(eventStatistics([], now)).toEqual({
      all: 0,
      last7: 0,
      last30: 0,
      forced: 0,
      compensation: 0,
      banked: 0,
    })
  })
})

describe('calendarDays', () => {
  it('buckets confirmed events onto China calendar dates', () => {
    const events = [
      // 23:30 local Beijing time on Aug 22 is inside the 28-day window.
      event('x', 'confirmed', '2026-08-22T15:30:00.000Z'),
    ]
    const days = calendarDays(events, now)
    expect(days).toHaveLength(28)
    const matched = days.find((day) => day.date === '2026-08-22')
    expect(matched?.count).toBe(1)
    expect(days.at(-1)?.date).toBe('2026-08-24')
  })

  it('ignores non-confirmed events', () => {
    const events = [event('y', 'expected', now.toISOString())]
    const days = calendarDays(events, now)
    expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(0)
  })
})

describe('selectVisiblePosts', () => {
  const posts = [
    post('3', '2026-08-24T02:00:00.000Z'),
    post('1', '2026-08-23T01:00:00.000Z', 'irrelevant'),
    post('2', '2026-08-24T01:00:00.000Z'),
  ]

  it('hides irrelevant posts and sorts newest first', () => {
    expect(selectVisiblePosts(posts, false).map((p) => p.id)).toEqual([
      '3',
      '2',
    ])
  })

  it('includes irrelevant posts when requested and does not mutate input', () => {
    const frozen = [...posts]
    const result = selectVisiblePosts(frozen, true)
    expect(result.map((p) => p.id)).toEqual(['3', '2', '1'])
    expect(frozen.map((p) => p.id)).toEqual(['3', '1', '2'])
  })
})
