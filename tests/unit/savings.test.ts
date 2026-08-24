import { describe, expect, it } from 'vitest'
import type { ResetEvent } from '../../app/domain/models'
import { computeResetWindowSavings } from '../../app/domain/savings'

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

function confirmed(confirmedAt: string): ResetEvent {
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

describe('computeResetWindowSavings', () => {
  it('sums observed burn between the reset signal and replenishment', () => {
    // Anchor 02:00. Pre-replenish burn: 60->70 (+10), 70->85 (+15). Then the
    // reset lands (85 -> 5) which is NOT consumption.
    const events = [confirmed('2026-08-23T02:00:00.000Z')]
    const observations = [
      observation('2026-08-23T01:00:00.000Z', 55),
      observation('2026-08-23T02:30:00.000Z', 60),
      observation('2026-08-23T03:30:00.000Z', 70),
      observation('2026-08-23T04:30:00.000Z', 85),
      observation('2026-08-23T05:00:00.000Z', 5),
    ]
    const result = computeResetWindowSavings(events, observations, {}, now)
    expect(result.windows).toBe(1)
    expect(result.savedQuotaPercent).toBe(25)
    expect(result.equivalentFullWindows).toBe(0.25)
  })

  it('skips windows without an observed replenishment and banked resets', () => {
    const banked = {
      ...confirmed('2026-08-22T02:00:00.000Z'),
      resetKind: 'banked' as const,
      eventId: 'banked',
      contentHash: 'c'.repeat(64),
    }
    const observations = [
      observation('2026-08-22T02:10:00.000Z', 50),
      observation('2026-08-24T02:10:00.000Z', 52),
    ]
    const result = computeResetWindowSavings(
      [banked, confirmed('2026-08-24T02:00:00.000Z')],
      observations,
      {},
      now,
    )
    // The only non-banked anchor has no replenishment inside its horizon.
    expect(result.windows).toBe(0)
    expect(result.savedQuotaPercent).toBe(0)
  })

  it('ignores anchors outside the lookback window', () => {
    const events = [confirmed('2026-01-01T02:00:00.000Z')]
    const observations = [
      observation('2026-01-01T03:00:00.000Z', 80),
      observation('2026-01-01T04:00:00.000Z', 5),
    ]
    expect(
      computeResetWindowSavings(events, observations, {}, now).windows,
    ).toBe(0)
  })
})
