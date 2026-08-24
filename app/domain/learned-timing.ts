import type { CodexRateLimitObservation, ResetEvent } from './models.js'

/**
 * Estimates how long a Tibo-announced reset takes to actually replenish the
 * local account, from paired history: for each confirmed (non-banked) event,
 * find the earliest observation within 24h whose usedPercent drops to or
 * below 20. Returns the median delay in whole hours, or null when there is
 * not enough paired history.
 */
export function learnedPropagationDelayHours(
  events: ResetEvent[],
  observations: CodexRateLimitObservation[],
  now = Date.now(),
): number | null {
  const sortedObservations = [...observations]
    .filter((item) => !Number.isNaN(Date.parse(item.observedAt)))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
  const delaysHours: number[] = []
  const confirmedTimes = events
    .filter(
      (event) =>
        event.status === 'confirmed' &&
        event.resetKind !== 'banked' &&
        Number.isFinite(Date.parse(event.confirmedAt ?? '')),
    )
    .map((event) => Date.parse(event.confirmedAt as string))
    .filter((at) => now - at <= 60 * 86_400_000)
    .sort((a, b) => b - a)

  for (const resetAt of confirmedTimes.slice(0, 10)) {
    let priorUsedPercent: number | null = null
    let matchedDelayMs: number | null = null
    for (const observation of sortedObservations) {
      const observedAt = Date.parse(observation.observedAt)
      if (observedAt < resetAt) {
        if (observation.usedPercent !== null)
          priorUsedPercent = observation.usedPercent
        continue
      }
      if (observedAt > resetAt + 24 * 3_600_000) break
      if (
        priorUsedPercent !== null &&
        priorUsedPercent >= 40 &&
        observation.usedPercent !== null &&
        observation.usedPercent <= 20
      ) {
        matchedDelayMs = observedAt - resetAt
        break
      }
      if (observation.usedPercent !== null)
        priorUsedPercent = observation.usedPercent
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
