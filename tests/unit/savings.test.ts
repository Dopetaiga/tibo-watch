import { describe, expect, it } from 'vitest'
import {
  computeSavings,
  defaultSavingsConfig,
  type UsageBucket,
} from '../../app/domain/savings'

const now = new Date('2026-08-24T12:00:00.000Z')

function bucket(daysAgo: number, tokens: number): UsageBucket {
  return {
    startDate: new Date(now.getTime() - daysAgo * 86_400_000)
      .toISOString()
      .slice(0, 10),
    tokens,
  }
}

describe('computeSavings', () => {
  it('aggregates the trailing 28 days and converts to API-equivalent dollars', () => {
    const summary = computeSavings(
      [bucket(0, 2_000_000), bucket(27, 1_000_000), bucket(40, 9_999_999)],
      defaultSavingsConfig,
      now,
    )
    expect(summary.tokens28d).toBe(3_000_000)
    expect(summary.apiEquivalentUsd).toBe(6)
    expect(summary.peakDailyTokens).toBe(2_000_000)
    expect(summary.daysObserved).toBe(2)
    // $6 usage vs $20 plan prorated over 28/30 days → negative net.
    expect(summary.netVsPlanUsd).toBeLessThan(0)
  })

  it('reports positive savings when API equivalence exceeds prorated plan', () => {
    const summary = computeSavings(
      [bucket(3, 50_000_000)],
      { ...defaultSavingsConfig, planMonthlyPriceUsd: 20 },
      now,
    )
    expect(summary.apiEquivalentUsd).toBe(100)
    expect(summary.netVsPlanUsd).toBeCloseTo(100 - (20 * 28) / 30, 2)
  })

  it('hides money metrics when no plan price is configured', () => {
    const summary = computeSavings(
      [bucket(0, 1_500_000)],
      { ...defaultSavingsConfig, planMonthlyPriceUsd: null },
      now,
    )
    expect(summary.netVsPlanUsd).toBeNull()
    expect(summary.apiEquivalentUsd).toBe(3)
  })

  it('tolerates empty or malformed buckets', () => {
    const summary = computeSavings(
      [
        { startDate: 'not-a-date', tokens: 5 },
        { startDate: '2026-08-24', tokens: Number.NaN },
      ],
      defaultSavingsConfig,
      now,
    )
    expect(summary.tokens28d).toBe(0)
    expect(summary.avgDailyTokens).toBe(0)
    expect(summary.peakDailyTokens).toBe(0)
  })
})
