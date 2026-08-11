export type DashboardHealth = 'healthy' | 'degraded' | 'offline' | 'disabled'
export type DashboardDetailKind = 'post' | 'analysis' | 'event' | 'notification'

export interface DashboardPost {
  id: string
  excerpt: string
  capturedAt: string
  ruleMatched: boolean
  aiCalled: boolean
  formedEvent: boolean
}

export interface DashboardEvent {
  id: string
  title: string
  type: 'forced' | 'compensation' | 'banked'
  status: 'confirmed' | 'expected' | 'candidate'
  occurredAt: string
  sourceUrl: string
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
  health: DashboardHealth
  lastCheckedAt: string | null
  consecutiveFailures: number
  pollingIntervalMinutes: number
  stale: boolean
  prediction24h: string | null
  prediction48h: string | null
  latestSummary: string | null
  latestSourceUrl: string | null
  latestEvidence: string[]
  posts: DashboardPost[]
  events: DashboardEvent[]
  requestLogs: Array<{
    timestamp: string
    target: string
    status: string
    durationMs: number
  }>
  details?: Partial<Record<DashboardDetailKind, DashboardDetail[]>>
}
