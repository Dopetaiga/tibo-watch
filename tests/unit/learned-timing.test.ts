import { describe, expect, it } from 'vitest'
import type { ResetEvent } from '../../app/domain/models'
import { learnedPropagationDelayHours } from '../../app/domain/learned-timing'

const now = Date.parse('2026-08-24T12:00:00.000Z')

function observation(iso: string, usedPercent: number) {
  return {
    schemaVersion: 1 as const,
    createdAt: iso,
    source: 'test',
    contentHash: 'a'.repeat(64),
    observationId: iso,
    observedAt: iso,
    usedPercent,
    resetsAt: null,
    windowDurationMins: null,
    availableResetCredits: null,
    resetCredits: null,
  }
}

function confirmedEvent(confirmedAt: string): ResetEvent {
  return {
    schemaVersion: 1,
    createdAt: confirmedAt,
    source: 'test',
    contentHash: 'b'.repeat(64),
    eventId: confirmedAt,
    postId: confirmedAt,
    analysisVersion: 'v',
    status: 'confirmed',
    eventType: 'completed',
    resetKind: 'forced',
    scope: '',
    expectedStart: null,
    expectedEnd: null,
    confirmedAt,
    titleZh: '',
  }
}

describe('learnedPropagationDelayHours', () => {
  it('returns the median of paired replenishment delays', () => {
    const events = [
      confirmedEvent('2026-08-20T02:00:00.000Z'),
      confirmedEvent('2026-08-23T03:00:00.000Z'),
    ]
    // First reset propagates in ~1h; second in ~3h → median ≈2.1h → ceil 3.
    const observations = [
      observation('2026-08-20T01:30:00.000Z', 70),
      observation('2026-08-20T03:10:00.000Z', 5),
      observation('2026-08-23T01:00:00.000Z', 65),
      observation('2026-08-23T06:05:00.000Z', 8),
    ]
    expect(learnedPropagationDelayHours(events, observations, now)).toBe(3)
  })

  it('returns null without enough paired history', () => {
    expect(
      learnedPropagationDelayHours(
        [confirmedEvent('2026-08-23T02:00:00.000Z')],
        [observation('2026-08-23T01:00:00.000Z', 90)],
        now,
      ),
    ).toBeNull()
  })

  it('skips banked resets and stale events beyond 60 days', () => {
    const banked = {
      ...confirmedEvent('2026-08-23T02:00:00.000Z'),
      resetKind: 'banked' as const,
      eventId: 'banked',
      contentHash: 'c'.repeat(64),
    }
    const stale = confirmedEvent('2026-01-01T00:00:00.000Z')
    expect(
      learnedPropagationDelayHours(
        [banked, stale],
        [observation('2026-08-23T04:00:00.000Z', 3)],
        now,
      ),
    ).toBeNull()
  })

  it('uses the weekly series so routine 5h rollovers do not pollute delays', () => {
    const events = [confirmedEvent('2026-08-23T02:00:00.000Z')]
    // Primary series has routine 5h rollover drops (03:00, 08:00); the
    // weekly series only drops once at 04:00 — the real forced reset.
    const rows = [
      { iso: '2026-08-23T01:00:00.000Z', primary: 70, secondary: 40 },
      { iso: '2026-08-23T03:00:00.000Z', primary: 5, secondary: 41 },
      { iso: '2026-08-23T04:00:00.000Z', primary: 30, secondary: 3 },
      { iso: '2026-08-23T08:00:00.000Z', primary: 8, secondary: 4 },
    ]
    const observations = rows.map((row) => ({
      ...observation(row.iso, row.primary),
      secondaryUsedPercent: row.secondary,
    }))
    expect(learnedPropagationDelayHours(events, observations, now)).toBe(2)
  })
})
