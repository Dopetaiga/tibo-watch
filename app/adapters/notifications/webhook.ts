import type {
  NotificationChannel,
  NotificationDelivery,
  NotificationMessage,
} from './types.js'

export interface WebhookOptions {
  id: 'feishu' | 'http'
  url: () => Promise<string>
  headers?: () => Promise<Record<string, string>>
  fetch?: typeof fetch
}

export class WebhookNotificationChannel implements NotificationChannel {
  readonly id: 'feishu' | 'http'
  readonly #url: () => Promise<string>
  readonly #headers?: () => Promise<Record<string, string>>
  readonly #fetch: typeof fetch

  constructor(options: WebhookOptions) {
    this.id = options.id
    this.#url = options.url
    this.#headers = options.headers
    this.#fetch = options.fetch ?? fetch
  }

  async send(
    message: NotificationMessage,
    signal: AbortSignal,
  ): Promise<NotificationDelivery> {
    const attemptedAt = new Date().toISOString()
    try {
      const body = this.id === 'feishu' ? feishuBody(message) : message
      const response = await this.#fetch(await this.#url(), {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          ...(await this.#headers?.()),
        },
        body: JSON.stringify(body),
      })
      return {
        channel: this.id,
        ok: response.ok,
        attemptedAt,
        statusCode: response.status,
        errorCode: response.ok ? null : `HTTP_${response.status}`,
      }
    } catch (error) {
      return {
        channel: this.id,
        ok: false,
        attemptedAt,
        statusCode: null,
        errorCode: error instanceof Error ? error.name : 'WEBHOOK_ERROR',
      }
    }
  }
}

function feishuBody(message: NotificationMessage) {
  return {
    msg_type: 'text',
    content: {
      text: `${message.isTest ? '[测试] ' : ''}${message.title}\n${message.summaryZh}\n预计：${message.expectedWindow}\n不确定性：${message.uncertainties.join('；') || '无'}\n${message.sourceUrl}`,
    },
  }
}
