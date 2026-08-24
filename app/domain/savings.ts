export interface UsageBucket {
  startDate: string
  tokens: number
}

export interface SavingsConfig {
  /** User's subscription price per month in USD; null hides money metrics. */
  planMonthlyPriceUsd: number | null
  /** Shadow API price used to translate tokens into dollars. */
  referenceUsdPerMTokens: number
}

export interface SavingsSummary {
  tokens28d: number
  avgDailyTokens: number
  peakDailyTokens: number
  apiEquivalentUsd: number
  netVsPlanUsd: number | null
  daysObserved: number
}

export const defaultSavingsConfig: SavingsConfig = {
  planMonthlyPriceUsd: 20,
  referenceUsdPerMTokens: 2,
}

const windowMs = 28 * 86_400_000

/**
 * Token-based savings estimate for the last 28 days. The API-equivalent cost
 * is what the same token volume would cost at the reference per-million
 * price; net-vs-plan subtracts the prorated subscription fee, i.e. how much
 * of the usage value exceeds what the plan already paid for.
 */
export function computeSavings(
  buckets: UsageBucket[],
  config: SavingsConfig = defaultSavingsConfig,
  now = new Date(),
): SavingsSummary {
  const cutoff = now.getTime() - windowMs
  const recent = buckets.filter((bucket) => {
    const startAt = Date.parse(`${bucket.startDate}T00:00:00.000Z`)
    return (
      Number.isFinite(startAt) &&
      startAt >= cutoff &&
      startAt <= now.getTime() &&
      Number.isFinite(bucket.tokens) &&
      bucket.tokens >= 0
    )
  })
  const tokens28d = recent.reduce((sum, bucket) => sum + bucket.tokens, 0)
  const peakDailyTokens = recent.reduce(
    (peak, bucket) => Math.max(peak, bucket.tokens),
    0,
  )
  const apiEquivalentUsd =
    Math.round((tokens28d / 1_000_000) * config.referenceUsdPerMTokens * 100) /
    100
  const netVsPlanUsd =
    config.planMonthlyPriceUsd === null
      ? null
      : Math.round(
          (apiEquivalentUsd - (config.planMonthlyPriceUsd * 28) / 30) * 100,
        ) / 100
  return {
    tokens28d,
    avgDailyTokens:
      recent.length > 0 ? Math.round(tokens28d / recent.length) : 0,
    peakDailyTokens,
    apiEquivalentUsd,
    netVsPlanUsd,
    daysObserved: recent.length,
  }
}
