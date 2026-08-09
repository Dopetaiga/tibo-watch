export interface NotificationMessage {
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
