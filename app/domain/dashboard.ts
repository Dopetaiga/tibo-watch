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
  health: DashboardHealth
  healthMessage: string
  lastCheckedAt: string | null
  consecutiveFailures: number
  pollingIntervalMinutes: number
  stale: boolean
  lastObservedResetAt: string | null
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
): Pick<DashboardModel, 'lastObservedResetAt' | 'baselineNextResetAt'> {
  const latest = events
    .filter(({ status, type }) => status === 'confirmed' && type !== 'banked')
    .map(({ occurredAt }) => occurredAt)
    .filter((value) => !Number.isNaN(Date.parse(value)))
    .sort((a, b) => b.localeCompare(a))[0]
  if (!latest) return { lastObservedResetAt: null, baselineNextResetAt: null }
  return {
    lastObservedResetAt: latest,
    baselineNextResetAt: new Date(
      Date.parse(latest) + 7 * 86_400_000,
    ).toISOString(),
  }
}
