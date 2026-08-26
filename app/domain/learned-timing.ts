import type { CodexRateLimitObservation, ResetEvent } from './models.js'

const maxPairGapMs = 12 * 3_600_000
const maxPropagationMs = 24 * 3_600_000
const historyMs = 60 * 86_400_000

type Series = Array<{ at: number; used: number | null }>

function buildSeries(
  observations: CodexRateLimitObservation[],
  pick: (observation: CodexRateLimitObservation) => {
    used: number | null
    at: string
  },
): Series {
  return observations
    .map((observation) => ({
      at: Date.parse(pick(observation).at),
      used: pick(observation).used,
    }))
    .filter((point) => Number.isFinite(point.at))
    .sort((a, b) => a.at - b.at)
}

/** Timestamps where usage fell from ≥40% to ≤20% (a replenishment). */
function replenishDropTimes(series: Series): number[] {
  const drops: number[] = []
  let priorUsed: number | null = null
  let priorAt = Number.NaN
  for (const point of series) {
    if (priorUsed !== null && !Number.isNaN(priorAt)) {
      if (
        point.at - priorAt <= maxPairGapMs &&
        priorUsed >= 40 &&
        point.used !== null &&
        point.used <= 20
      )
        drops.push(point.at)
    }
    if (point.used !== null) {
      priorUsed = point.used
      priorAt = point.at
    }
  }
  return drops
}

/**
 * Estimates how long a Tibo-announced reset takes to actually replenish the
 * local account. Prefers the weekly (secondary) window series — its drops
 * are rare and immune to routine 5h rollovers — falling back to the legacy
 * primary series on older observations. Median of the last paired events,
 * rounded up to whole hours and clamped to 1..168.
 */
export function learnedPropagationDelayHours(
  events: ResetEvent[],
  observations: CodexRateLimitObservation[],
  now = Date.now(),
): number | null {
  const secondarySeries = buildSeries(observations, (o) => ({
    used: o.secondaryUsedPercent ?? null,
    at: o.observedAt,
  }))
  const primarySeries = buildSeries(observations, (o) => ({
    used: o.usedPercent,
    at: o.observedAt,
  }))
  const secondaryDrops = replenishDropTimes(secondarySeries)
  const primaryDrops = replenishDropTimes(primarySeries)
  // Prefer weekly when it has any signal; otherwise legacy primary.
  const drops =
    secondaryDrops.length > 0 || secondarySeries.some((p) => p.used !== null)
      ? secondaryDrops
      : primaryDrops

  const confirmedTimes = events
    .filter(
      (event) =>
        event.status === 'confirmed' &&
        event.resetKind !== 'banked' &&
        Number.isFinite(Date.parse(event.confirmedAt ?? '')),
    )
    .map((event) => Date.parse(event.confirmedAt as string))
    .filter((at) => now - at <= historyMs)
    .sort((a, b) => b - a)

  const delaysHours: number[] = []
  for (const resetAt of confirmedTimes.slice(0, 10)) {
    let matchedDelayMs: number | null = null
    for (const dropAt of drops) {
      if (dropAt < resetAt) continue
      if (dropAt > resetAt + maxPropagationMs) break
      matchedDelayMs = dropAt - resetAt
      break
    }
    if (matchedDelayMs !== null && matchedDelayMs >= 0)
      delaysHours.push(matchedDelayMs / 3_600_000)
  }
  if (delaysHours.length === 0) return null
  delaysHours.sort((a, b) => a - b)
  const middle = Math.floor(delaysHours.length / 2)
  const median =
    delaysHours.length % 2 === 0
      ? (delaysHours[middle - 1] + delaysHours[middle]) / 2
      : delaysHours[middle]
  return Math.min(168, Math.max(1, Math.ceil(median)))
}
