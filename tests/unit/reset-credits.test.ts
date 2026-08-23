import { describe, expect, it } from 'vitest'
import type { CodexRateLimitObservation } from '../../app/domain/models'
import { summarizeResetCredits } from '../../app/domain/reset-credits'

const now = Date.parse('2026-08-23T12:00:00.000Z')

function observation(
  observedAt: string,
  usedPercent: number,
  availableResetCredits: number,
  overrides: Partial<CodexRateLimitObservation> = {},
): CodexRateLimitObservation {
  return {
    schemaVersion: 1,
    createdAt: observedAt,
    source: 'test',
    contentHash: 'a'.repeat(64),
    observationId: observedAt,
    observedAt,
    usedPercent,
    resetsAt: null,
    windowDurationMins: 10_080,
    availableResetCredits,
    resetCredits: null,
    ...overrides,
  }
}

describe('banked reset statistics', () => {
  it('confirms a card use when count drops as quota replenishes off-cycle', () => {
    const summary = summarizeResetCredits(
      [
        observation('2026-08-23T08:00:00.000Z', 92, 2),
        observation('2026-08-23T08:10:00.000Z', 3, 1),
      ],
      [],
      now,
    )
    expect(summary).toMatchObject({
      availableCount: 1,
      usesLast28Days: 1,
      lastUseConfidence: 'confirmed',
    })
  })

  it('does not count a normal scheduled reset as card usage', () => {
    const resetAt = Date.parse('2026-08-23T08:05:00.000Z') / 1_000
    const summary = summarizeResetCredits(
      [
        observation('2026-08-23T08:00:00.000Z', 92, 2, { resetsAt: resetAt }),
        observation('2026-08-23T08:10:00.000Z', 3, 2),
      ],
      [],
      now,
    )
    expect(summary.usesLast28Days).toBe(0)
  })

  it('uses official expiry and counts a vanished expired card', () => {
    const grantedAt = Date.parse('2026-07-26T08:00:00.000Z') / 1_000
    const expiresAt = Date.parse('2026-08-23T08:00:00.000Z') / 1_000
    const credit = {
      id: 'credit-1',
      grantedAt,
      expiresAt,
      status: 'available' as const,
      resetType: 'codexRateLimits' as const,
      title: null,
      description: null,
    }
    const summary = summarizeResetCredits(
      [
        observation('2026-08-23T07:55:00.000Z', 30, 1, {
          resetCredits: [credit],
        }),
        observation('2026-08-23T08:05:00.000Z', 31, 0, {
          resetCredits: [],
        }),
      ],
      [],
      now,
    )
    expect(summary.expiredLast28Days).toBe(1)
    expect(summary.usesLast28Days).toBe(0)
  })

  it('does not infer usage across a long observation gap', () => {
    const summary = summarizeResetCredits(
      [
        observation('2026-08-22T08:00:00.000Z', 95, 2),
        observation('2026-08-23T08:00:00.000Z', 2, 1),
      ],
      [],
      now,
    )
    expect(summary.usesLast28Days).toBe(0)
  })
})
