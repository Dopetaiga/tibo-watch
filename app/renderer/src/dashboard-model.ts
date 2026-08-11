export interface DashboardEvent {
  id: string
  title: string
  type: 'forced' | 'compensation' | 'banked'
  status: 'confirmed' | 'expected' | 'candidate'
  occurredAt: string
  sourceUrl: string
}

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
    const key = localDateKey(new Date(event.occurredAt))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from({ length: 28 }, (_, index) => {
    const date = new Date(now)
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - (27 - index))
    const key = localDateKey(date)
    return { date: key, day: date.getDate(), count: counts.get(key) ?? 0 }
  })
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
