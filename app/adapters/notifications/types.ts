export type AutomationEventType =
  | 'rule_candidate'
  | 'ai_confirmed'
  | 'reset_observed'
  | 'codex_resume_started'
  | 'codex_resume_waiting_approval'
  | 'codex_resume_completed'
  | 'codex_resume_failed'

export interface NotificationMessage {
  schemaVersion: 1
  eventType: AutomationEventType
  eventId: string
  semanticVersion: string
  title: string
  summaryZh: string
  expectedWindow: string
  uncertainties: string[]
  sourceUrl: string
  isTest: boolean
}

export interface NotificationDelivery {
  channel: string
  ok: boolean
  attemptedAt: string
  statusCode: number | null
  errorCode: string | null
}

export interface NotificationChannel {
  readonly id: 'windows' | 'feishu' | 'http'
  send(
    message: NotificationMessage,
    signal: AbortSignal,
  ): Promise<NotificationDelivery>
}
