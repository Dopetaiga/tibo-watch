import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resetOverview } from '../../app/domain/dashboard'
import {
  calendarDays,
  eventStatistics,
} from '../../app/renderer/src/dashboard-model'

const events = [
  {
    id: '1',
    title: 'A',
    type: 'forced' as const,
    status: 'confirmed' as const,
    occurredAt: '2026-08-09T00:30:00.000Z',
    sourceUrl: 'x',
  },
  {
    id: '2',
    title: 'B',
    type: 'banked' as const,
    status: 'confirmed' as const,
    occurredAt: '2026-08-08T23:30:00.000Z',
    sourceUrl: 'x',
  },
  {
    id: '3',
    title: 'C',
    type: 'compensation' as const,
    status: 'candidate' as const,
    occurredAt: '2026-08-09T01:00:00.000Z',
    sourceUrl: 'x',
  },
]

describe('dashboard statistics', () => {
  it('counts confirmed facts only', () => {
    expect(
      eventStatistics(events, new Date('2026-08-09T12:00:00.000Z')),
    ).toMatchObject({ all: 2, last7: 2, forced: 1, banked: 1, compensation: 0 })
  })

  it('groups calendar days in China Standard Time', () => {
    const calendar = calendarDays(events, new Date('2026-08-09T12:00:00.000Z'))
    expect(calendar.reduce((sum, day) => sum + day.count, 0)).toBe(2)
    expect(calendar).toHaveLength(28)
    expect(Math.max(...calendar.map(({ count }) => count))).toBe(2)
  })

  it('anchors the baseline to the latest observed reset plus seven days', () => {
    expect(resetOverview(events)).toEqual({
      lastObservedResetAt: '2026-08-09T00:30:00.000Z',
      baselineNextResetAt: '2026-08-16T00:30:00.000Z',
    })
  })

  it('does not anchor the baseline to future or candidate messages', () => {
    expect(resetOverview([events[2]])).toEqual({
      lastObservedResetAt: null,
      baselineNextResetAt: null,
    })
  })

  it('does not anchor the baseline to a banked reset', () => {
    expect(resetOverview([events[1]])).toEqual({
      lastObservedResetAt: null,
      baselineNextResetAt: null,
    })
  })

  it('renders untrusted detail payloads through React text nodes only', () => {
    const source = readFileSync('app/renderer/src/App.tsx', 'utf8')
    expect(source).not.toContain('dangerouslySetInnerHTML')
    expect(source).toContain('JSON.stringify(selected.payload')
  })
})
