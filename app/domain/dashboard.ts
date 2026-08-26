export type DashboardHealth =
  'starting' | 'healthy' | 'degraded' | 'offline' | 'disabled'
export type DashboardDetailKind =
  'post' | 'analysis' | 'event' | 'notification' | 'resume'

export interface DashboardPost {
  id: string
  sourceUrl: string
  kind: 'original' | 'reply' | 'quote'
  excerpt: string
  postedAt: string
  ruleMatched: boolean
  aiCalled: boolean
  formedEvent: boolean
  relevance: 'candidate' | 'relevant' | 'related_non_reset' | 'irrelevant'
  eventType:
    'completed' | 'explicit_future' | 'vague_intent' | 'non_event' | null
}

export interface DashboardEvent {
  id: string
  title: string
  type: 'forced' | 'compensation' | 'banked'
  status: 'confirmed' | 'expected' | 'candidate'
  occurredAt: string
  sourceUrl: string
}

export interface DashboardResetChain {
  id: string
  kind: 'forced' | 'compensation' | 'banked'
  status: 'tracking' | 'completed'
  startedAt: string
  completedAt: string | null
  items: Array<{
    eventId: string
    postId: string
    postedAt: string
    status: 'candidate' | 'expected' | 'confirmed'
    title: string
    text: string
    sourceUrl: string
  }>
}

export interface DashboardDetail {
  id: string
  title: string
  timestamp: string
  version: string
  sourceUrl?: string
  payload: Record<string, unknown>
}

export interface DashboardModel {
  monitorMode: 'rule-only' | 'ai-enhanced'
  serviceStatus: 'starting' | 'running' | 'stopped'
  dataStatus: 'updating' | 'current' | 'stale' | 'error' | 'disabled'
  health: DashboardHealth
  healthMessage: string
  savings: {
    /** Reset windows analyzed in the lookback period. */
    windows: number
    /** Quota consumed between reset signal and replenishment (percent pts). */
    savedQuotaPercent: number
    equivalentFullWindows: number
  } | null
  codexAccount: { linked: boolean; expired: boolean } | null
  quotaWindows: {
    fiveHour: { usedPercent: number | null; resetsInMs: number | null }
    weekly: { usedPercent: number | null; resetsInMs: number | null }
  } | null
  codexRuns: {
    completed28d: number
    failed28d: number
    blocked28d: number
  }
  lastCheckedAt: string | null
  consecutiveFailures: number
  pollingIntervalMinutes: number
  stale: boolean
  lastObservedResetAt: string | null
  lastInferredResetAt: string | null
  baselinePreviousResetAt: string | null
  baselineNextResetAt: string | null
  signalPrediction: {
    start: string | null
    end: string | null
    title: string
    sourceText: string
    sourcePostedAt: string | null
    sourceUrl: string | null
  } | null
  prediction24h: string | null
  prediction48h: string | null
  latestSummary: string | null
  latestSourceUrl: string | null
  latestEvidence: string[]
  resetCredits: {
    availableCount: number | null
    nextExpiryAt: string | null
    lastUsedAt: string | null
    lastUseConfidence: 'confirmed' | 'inferred' | null
    usesLast28Days: number
    expiredLast28Days: number
    detailSource: 'api' | 'count-only' | 'inferred' | 'unavailable'
  }
  posts: DashboardPost[]
  events: DashboardEvent[]
  resetChains: DashboardResetChain[]
  requestLogs: Array<{
    timestamp: string
    target: string
    status: string
    durationMs: number
  }>
  details?: Partial<Record<DashboardDetailKind, DashboardDetail[]>>
}

export function resetOverview(
  events: DashboardEvent[],
  now = Date.now(),
): Pick<
  DashboardModel,
  | 'lastObservedResetAt'
  | 'lastInferredResetAt'
  | 'baselinePreviousResetAt'
  | 'baselineNextResetAt'
> {
  const latest = (status: DashboardEvent['status']) =>
    events
      .filter(
        ({ status: value, type }) => value === status && type !== 'banked',
      )
      .map(({ occurredAt }) => occurredAt)
      .filter((value) => {
        const timestamp = Date.parse(value)
        return !Number.isNaN(timestamp) && timestamp <= now
      })
      .sort((a, b) => b.localeCompare(a))[0]
  const confirmed = latest('confirmed')
  const elapsedForecast = latest('expected')
  const inferred =
    elapsedForecast &&
    (!confirmed || Date.parse(elapsedForecast) > Date.parse(confirmed))
      ? elapsedForecast
      : undefined
  const anchorValue = inferred ?? confirmed
  if (!anchorValue)
    return {
      lastObservedResetAt: null,
      lastInferredResetAt: null,
      baselinePreviousResetAt: null,
      baselineNextResetAt: null,
    }
  const anchor = Date.parse(anchorValue)
  const cycleDuration = 7 * 86_400_000
  const elapsed = Math.max(0, now - anchor)
  const nextCycle = Math.floor(elapsed / cycleDuration) + 1
  const next = anchor + nextCycle * cycleDuration
  return {
    lastObservedResetAt: confirmed ?? null,
    lastInferredResetAt: inferred ?? null,
    baselinePreviousResetAt: new Date(next - cycleDuration).toISOString(),
    baselineNextResetAt: new Date(next).toISOString(),
  }
}
