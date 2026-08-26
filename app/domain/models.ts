export interface FactRecord {
  schemaVersion: 1
  createdAt: string
  source: string
  contentHash: string
}

export interface Post extends FactRecord {
  postId: string
  url: string
  author: string
  text: string
  postedAt: string
  kind: 'original' | 'reply' | 'quote'
  parentPostId: string | null
  quotedPostId: string | null
}

export interface Analysis extends FactRecord {
  postId: string
  analysisVersion: string
  ruleVersion: string
  promptVersion: string | null
  model: string | null
  relevance: 'relevant' | 'related_non_reset' | 'irrelevant'
  eventType: 'completed' | 'explicit_future' | 'vague_intent' | 'non_event'
  scope: string
  expectedWindow: {
    start: string | null
    end: string | null
    original: string | null
  }
  confidence: 'low' | 'medium' | 'high'
  translationZh: string
  summaryZh: string
  evidence: string[]
  uncertainties: string[]
  sourceUrl: string
  responseHash: string | null
}

export type ResetEventStatus =
  'candidate' | 'expected' | 'confirmed' | 'denied' | 'expired'

export interface ResetEvent extends FactRecord {
  eventId: string
  postId: string
  analysisVersion: string
  status: ResetEventStatus
  eventType: 'completed' | 'explicit_future' | 'vague_intent'
  resetKind: 'forced' | 'compensation' | 'banked'
  scope: string
  expectedStart: string | null
  expectedEnd: string | null
  confirmedAt: string | null
  titleZh: string
}

export interface Notification extends FactRecord {
  notificationId: string
  eventId: string
  channel: 'windows' | 'feishu' | 'http'
  semanticVersion: string
  status: 'pending' | 'sent' | 'failed' | 'suppressed'
  attemptedAt: string | null
  errorCode: string | null
  isTest: boolean
}

export interface RuntimeState extends FactRecord {
  stateId: 'runtime'
  lastCheckedAt: string | null
  sourceStatus: 'disabled' | 'healthy' | 'degraded' | 'offline'
  consecutiveFailures: number
  pollingIntervalMs: number
  activeSignalUntil: string | null
  lastPostId: string | null
}

export interface CodexResumeAudit extends FactRecord {
  resumeId: string
  eventId: string
  threadId: string
  triggerMode: 'rule-only' | 'rule+ai'
  status: 'started' | 'completed' | 'failed' | 'blocked'
  startedAt: string
  finishedAt: string | null
  turnId: string | null
  usedPercent: number | null
  errorCode: string | null
  /** Optional additive fields (schemaVersion stays 1). */
  phase?: 'waiting_approval' | 'running' | 'done'
  turnSummary?: string | null
  durationMs?: number | null
}

export interface CodexRateLimitObservation extends FactRecord {
  observationId: string
  observedAt: string
  usedPercent: number | null
  resetsAt: number | null
  windowDurationMins: number | null
  availableResetCredits: number | null
  resetCredits: Array<{
    id: string
    grantedAt: number
    expiresAt: number | null
    status: 'available' | 'redeeming' | 'redeemed' | 'unknown'
    resetType: 'codexRateLimits' | 'unknown'
    title: string | null
    description: string | null
  }> | null
  /** Optional additive dual-window fields (schemaVersion stays 1). */
  secondaryUsedPercent?: number | null
  secondaryResetsAt?: number | null
  secondaryWindowDurationMins?: number | null
  creditsBalance?: string | null
  unlimited?: boolean | null
  spendControlReached?: boolean | null
  planType?: string | null
}

export type StoredRecord =
  | Post
  | Analysis
  | ResetEvent
  | Notification
  | RuntimeState
  | CodexResumeAudit
  | CodexRateLimitObservation

export function isFactRecord(value: unknown): value is FactRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === 1 &&
    typeof record.createdAt === 'string' &&
    !Number.isNaN(Date.parse(record.createdAt)) &&
    typeof record.source === 'string' &&
    typeof record.contentHash === 'string' &&
    /^[a-f0-9]{64}$/.test(record.contentHash)
  )
}
