import type { DashboardEvent } from '../../domain/dashboard'

export type { DashboardEvent } from '../../domain/dashboard'

export function eventStatistics(events: DashboardEvent[], now = new Date()) {
  const confirmed = events.filter(({ status }) => status === 'confirmed')
  const age = (event: DashboardEvent) =>
    now.getTime() - new Date(event.occurredAt).getTime()
  return {
    all: confirmed.length,
    last7: confirmed.filter((event) => age(event) <= 7 * 86_400_000).length,
    last30: confirmed.filter((event) => age(event) <= 30 * 86_400_000).length,
    forced: confirmed.filter(({ type }) => type === 'forced').length,
    compensation: confirmed.filter(({ type }) => type === 'compensation')
      .length,
    banked: confirmed.filter(({ type }) => type === 'banked').length,
  }
}

export function calendarDays(events: DashboardEvent[], now: Date) {
  const counts = new Map<string, number>()
  for (const event of events.filter(({ status }) => status === 'confirmed')) {
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
