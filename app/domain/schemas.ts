import {
  isFactRecord,
  type Analysis,
  type Notification,
  type Post,
  type ResetEvent,
  type RuntimeState,
} from './models.js'

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

function string(value: unknown): value is string {
  return typeof value === 'string'
}

export function isPost(value: unknown): value is Post {
  const record = object(value)
  return Boolean(
    isFactRecord(value) &&
    record &&
    string(record.postId) &&
    string(record.url) &&
    string(record.author) &&
    string(record.text) &&
    string(record.postedAt) &&
    ['original', 'reply', 'quote'].includes(String(record.kind)),
  )
}

export function isAnalysis(value: unknown): value is Analysis {
  const record = object(value)
  return Boolean(
    isFactRecord(value) &&
    record &&
    string(record.postId) &&
    string(record.analysisVersion) &&
    string(record.ruleVersion) &&
    ['relevant', 'related_non_reset', 'irrelevant'].includes(
      String(record.relevance),
    ) &&
    ['completed', 'explicit_future', 'vague_intent', 'non_event'].includes(
      String(record.eventType),
    ) &&
    ['low', 'medium', 'high'].includes(String(record.confidence)) &&
    Array.isArray(record.evidence) &&
    Array.isArray(record.uncertainties),
  )
}

export function isResetEvent(value: unknown): value is ResetEvent {
  const record = object(value)
  return Boolean(
    isFactRecord(value) &&
    record &&
    string(record.eventId) &&
    string(record.postId) &&
    ['candidate', 'expected', 'confirmed', 'denied', 'expired'].includes(
      String(record.status),
    ) &&
    ['forced', 'compensation', 'banked'].includes(String(record.resetKind)),
  )
}

export function isNotification(value: unknown): value is Notification {
  const record = object(value)
  return Boolean(
    isFactRecord(value) &&
    record &&
    string(record.notificationId) &&
    string(record.eventId) &&
    ['windows', 'feishu', 'http'].includes(String(record.channel)) &&
    ['pending', 'sent', 'failed', 'suppressed'].includes(String(record.status)),
  )
}

export function isRuntimeState(value: unknown): value is RuntimeState {
  const record = object(value)
  return Boolean(
    isFactRecord(value) &&
    record?.stateId === 'runtime' &&
    ['disabled', 'healthy', 'degraded', 'offline'].includes(
      String(record.sourceStatus),
    ) &&
    typeof record.consecutiveFailures === 'number' &&
    typeof record.pollingIntervalMs === 'number',
  )
}

export const recordKeys = {
  post: (post: Pick<Post, 'postId'>) => post.postId,
  analysis: (analysis: Pick<Analysis, 'postId' | 'analysisVersion'>) =>
    `${analysis.postId}--${analysis.analysisVersion}`,
  event: (event: Pick<ResetEvent, 'eventId'>) => event.eventId,
  notification: (notification: Pick<Notification, 'notificationId'>) =>
    notification.notificationId,
  runtime: () => 'runtime',
} as const
