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

export type StoredRecord =
  Post | Analysis | ResetEvent | Notification | RuntimeState

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
