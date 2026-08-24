import type { CodexRateLimitObservation, ResetEvent } from './models.js'

export interface ResetWindowSavings {
  /** Analyzed reset windows in the lookback period. */
  windows: number
  /**
   * Total quota (in percent-points of a window) consumed between the reset
   * signal and the observed replenishment — quota that would otherwise have
   * expired unused.
   */
  savedQuotaPercent: number
  /** savedQuotaPercent expressed in whole-window equivalents. */
  equivalentFullWindows: number
}

export interface ResetSavingsOptions {
  lookbackDays?: number
  /** Replenishment must be observed within this horizon of the anchor. */
  maxPropagationHours?: number
}

interface WindowAnchor {
  at: number
}

/**
 * Quota burned between a reset signal (confirmed announcement or a
 * materialised prediction) and the observed replenishment counts as saved:
 * without the reset it would have expired unused.
 *
 * Detection reuses the same replenishment heuristic as reset-credit
 * inference: prior sample >= 40% followed by <= 20% within the propagation
 * horizon. Observed consumption inside the window is the sum of positive
 * used-percent deltas between consecutive samples.
 */
export function computeResetWindowSavings(
  events: ResetEvent[],
  observations: CodexRateLimitObservation[],
  options: ResetSavingsOptions = {},
  now = Date.now(),
): ResetWindowSavings {
  const lookbackDays = options.lookbackDays ?? 56
  const maxPropagationMs = (options.maxPropagationHours ?? 24) * 3_600_000
  const cutoff = now - lookbackDays * 86_400_000

  const sortedObservations = [...observations]
    .filter((item) => !Number.isNaN(Date.parse(item.observedAt)))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))

  const anchors: WindowAnchor[] = []
  const seenAnchorDays = new Set<string>()
  for (const event of events) {
    const raw =
      event.status === 'confirmed'
        ? (event.confirmedAt ?? '')
        : event.status === 'expected'
          ? (event.expectedStart ?? '')
          : ''
    if (!raw || Number.isNaN(Date.parse(raw))) continue
    const at = Date.parse(raw)
    if (at < cutoff || at > now) continue
    if (event.resetKind === 'banked') continue
    const dayKey = `${event.status}:${new Date(at).toISOString().slice(0, 10)}`
    if (seenAnchorDays.has(dayKey)) continue
    seenAnchorDays.add(dayKey)
    anchors.push({ at })
  }
  anchors.sort((a, b) => a.at - b.at)

  let windows = 0
  let savedQuotaPercent = 0
  let searchFrom = 0 // observations index cursor; anchors are chronological

  for (const anchor of anchors) {
    let index = searchFrom
    while (
      index < sortedObservations.length &&
      Date.parse(sortedObservations[index].observedAt) < anchor.at
    )
      index += 1
    searchFrom = index
    if (index >= sortedObservations.length) break

    let prior =
      sortedObservations[index].usedPercent !== null
        ? (sortedObservations[index].usedPercent as number)
        : null
    let consumption = 0
    let replenishedAt = -1
    let cursor = index + 1
    for (; cursor < sortedObservations.length; cursor += 1) {
      const observation = sortedObservations[cursor]
      const observedAt = Date.parse(observation.observedAt)
      if (observedAt > anchor.at + maxPropagationMs) break
      const current = observation.usedPercent
      if (current === null) continue
      if (prior !== null) {
        if (prior >= 40 && current <= 20) {
          replenishedAt = cursor
          break
        }
        if (current > prior) consumption += current - prior
      }
      prior = current
    }
    if (replenishedAt === -1) continue
    windows += 1
    savedQuotaPercent += consumption
    searchFrom = replenishedAt
  }

  return {
    windows,
    savedQuotaPercent: Math.round(savedQuotaPercent * 10) / 10,
    equivalentFullWindows: Math.round(savedQuotaPercent) / 100,
  }
}
