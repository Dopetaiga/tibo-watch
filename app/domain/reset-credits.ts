import type { CodexRateLimitObservation } from './models.js'

const dayMs = 86_400_000
const observationWindowMs = 28 * dayMs
const maximumObservationGapMs = 12 * 60 * 60_000
const normalResetToleranceMs = 2 * 60 * 60_000

export interface ResetWindow {
  start: string | null
  end: string | null
}

export function summarizeResetCredits(
  observations: CodexRateLimitObservation[],
  resetWindows: ResetWindow[] = [],
  now = Date.now(),
) {
  const sorted = [...observations]
    .filter((item) => !Number.isNaN(Date.parse(item.observedAt)))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
  const latest = sorted.at(-1)
  const usages: Array<{
    observedAt: string
    confidence: 'confirmed' | 'inferred'
  }> = []
  let expiredLast28Days = 0

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    const previousAt = Date.parse(previous.observedAt)
    const currentAt = Date.parse(current.observedAt)
    if (currentAt - previousAt > maximumObservationGapMs) continue
    const replenished =
      previous.usedPercent !== null &&
      current.usedPercent !== null &&
      previous.usedPercent >= 70 &&
      current.usedPercent <= 20 &&
      previous.usedPercent - current.usedPercent >= 50
    const inNormalWindow = isNormalReset(previous, currentAt, resetWindows)
    const countDecreased =
      previous.availableResetCredits !== null &&
      current.availableResetCredits !== null &&
      current.availableResetCredits < previous.availableResetCredits

    if (replenished && !inNormalWindow) {
      usages.push({
        observedAt: current.observedAt,
        confidence: countDecreased ? 'confirmed' : 'inferred',
      })
      continue
    }

    if (!replenished && previous.resetCredits && current.resetCredits) {
      const currentIds = new Set(current.resetCredits.map(({ id }) => id))
      expiredLast28Days += previous.resetCredits.filter((credit) => {
        const expiresAt = creditExpiryMs(credit)
        return (
          !currentIds.has(credit.id) &&
          expiresAt <= currentAt &&
          expiresAt >= now - observationWindowMs
        )
      }).length
    }
  }

  const availableCredits = latest?.resetCredits?.filter(
    ({ status }) => status === 'available' || status === 'unknown',
  )
  const nextExpiryMs = availableCredits
    ?.map(creditExpiryMs)
    .filter((value) => value > now)
    .sort((a, b) => a - b)[0]
  const recentUsages = usages.filter(
    ({ observedAt }) => Date.parse(observedAt) >= now - observationWindowMs,
  )
  const lastUsage = usages.at(-1)

  return {
    availableCount: latest?.availableResetCredits ?? null,
    nextExpiryAt: nextExpiryMs ? new Date(nextExpiryMs).toISOString() : null,
    lastUsedAt: lastUsage?.observedAt ?? null,
    lastUseConfidence: lastUsage?.confidence ?? null,
    usesLast28Days: recentUsages.length,
    expiredLast28Days,
    detailSource: latest?.resetCredits
      ? ('api' as const)
      : latest?.availableResetCredits !== null &&
          latest?.availableResetCredits !== undefined
        ? ('count-only' as const)
        : observations.length > 1
          ? ('inferred' as const)
          : ('unavailable' as const),
  }
}

function creditExpiryMs(credit: {
  grantedAt: number
  expiresAt: number | null
}): number {
  // Epoch fields are milliseconds (normalized at the app-server adapter).
  return credit.expiresAt ?? credit.grantedAt + 28 * dayMs
}

function isNormalReset(
  previous: CodexRateLimitObservation,
  observedAt: number,
  windows: ResetWindow[],
): boolean {
  if (
    previous.resetsAt !== null &&
    Math.abs(previous.resetsAt - observedAt) <= normalResetToleranceMs
  )
    return true
  return windows.some(({ start, end }) => {
    const startAt = start ? Date.parse(start) : Number.NaN
    const endAt = end ? Date.parse(end) : startAt
    if (Number.isNaN(startAt)) return false
    const effectiveEnd = Number.isNaN(endAt) ? startAt : endAt
    return (
      observedAt >= startAt - normalResetToleranceMs &&
      observedAt <= effectiveEnd + normalResetToleranceMs
    )
  })
}
