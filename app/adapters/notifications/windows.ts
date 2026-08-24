import type {
  NotificationChannel,
  NotificationDelivery,
  NotificationMessage,
} from './types.js'

export type ShowWindowsNotification = (options: {
  title: string
  body: string
  sourceUrl: string
}) => Promise<void>

export class WindowsNotificationChannel implements NotificationChannel {
  readonly id = 'windows' as const

  constructor(readonly show: ShowWindowsNotification) {}

  async send(
    message: NotificationMessage,
    signal?: AbortSignal,
  ): Promise<NotificationDelivery> {
    const attemptedAt = new Date().toISOString()
    if (signal?.aborted)
      return {
        channel: this.id,
        ok: false,
        attemptedAt,
        statusCode: null,
        errorCode: 'TimeoutError',
      }
    try {
      await this.show({
        title: message.isTest ? `[测试] ${message.title}` : message.title,
        body: `${message.summaryZh}\n预计：${message.expectedWindow}\n不确定性：${message.uncertainties.join('；') || '无'}`,
        sourceUrl: message.sourceUrl,
      })
      return {
        channel: this.id,
        ok: true,
        attemptedAt,
        statusCode: null,
        errorCode: null,
      }
    } catch (error) {
      return {
        channel: this.id,
        ok: false,
        attemptedAt,
        statusCode: null,
        errorCode:
          error instanceof Error ? error.name : 'WINDOWS_NOTIFICATION_ERROR',
      }
    }
  }
}
