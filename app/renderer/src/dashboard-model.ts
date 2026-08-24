import type { DashboardEvent, DashboardModel } from '../../domain/dashboard'

export type { DashboardEvent } from '../../domain/dashboard'

export interface EventStatistics {
  all: number
  last7: number
  last30: number
  forced: number
  compensation: number
  banked: number
}

/** Single pass over confirmed events; O(n) instead of six filter passes. */
export function eventStatistics(
  events: DashboardEvent[],
  now = new Date(),
): EventStatistics {
  const nowMs = now.getTime()
  const week = 7 * 86_400_000
  const month = 30 * 86_400_000
  let all = 0
  let last7 = 0
  let last30 = 0
  let forced = 0
  let compensation = 0
  let banked = 0
  for (const event of events) {
    if (event.status !== 'confirmed') continue
    all += 1
    const age = nowMs - new Date(event.occurredAt).getTime()
    if (age <= week) last7 += 1
    if (age <= month) last30 += 1
    if (event.type === 'forced') forced += 1
    else if (event.type === 'compensation') compensation += 1
    else if (event.type === 'banked') banked += 1
  }
  return { all, last7, last30, forced, compensation, banked }
}

export function calendarDays(events: DashboardEvent[], now: Date) {
  const counts = new Map<string, number>()
  for (const event of events) {
    if (event.status !== 'confirmed') continue
    const key = chinaDateKey(new Date(event.occurredAt))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from({ length: 28 }, (_, index) => {
    const chinaNow = chinaDateParts(now)
    const date = new Date(
      Date.UTC(chinaNow.year, chinaNow.month - 1, chinaNow.day - (27 - index)),
    )
    const key = utcDateKey(date)
    return { date: key, day: date.getUTCDate(), count: counts.get(key) ?? 0 }
  })
}

/** Filter + newest-first sort for the history feed in one place (pure). */
export function selectVisiblePosts(
  posts: DashboardModel['posts'],
  includeIrrelevant: boolean,
): DashboardModel['posts'] {
  return posts
    .filter((post) => includeIrrelevant || post.relevance !== 'irrelevant')
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
}

function chinaDateKey(date: Date) {
  const parts = chinaDateParts(date)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function chinaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

function utcDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}
