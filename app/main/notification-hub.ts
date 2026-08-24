import { NotificationDispatcher } from '../adapters/notifications/dispatcher.js'
import { WindowsNotificationChannel } from '../adapters/notifications/windows.js'
import { WebhookNotificationChannel } from '../adapters/notifications/webhook.js'
import type {
  AutomationEventType,
  NotificationChannel,
  NotificationMessage,
} from '../adapters/notifications/types.js'
import type { Notification } from '../domain/models.js'

export type NotificationChannelKind = 'windows' | 'feishu' | 'http'

export type NotificationPolicy = Record<
  AutomationEventType,
  NotificationChannelKind[]
>

export const automationEventTypes: AutomationEventType[] = [
  'rule_candidate',
  'ai_confirmed',
  'reset_observed',
  'codex_resume_started',
  'codex_resume_waiting_approval',
  'codex_resume_completed',
  'codex_resume_failed',
]

export function defaultNotificationPolicy(): NotificationPolicy {
  return Object.fromEntries(
    automationEventTypes.map((eventType) => [
      eventType,
      ['windows', 'feishu', 'http'],
    ]),
  ) as NotificationPolicy
}

export function validateNotificationPolicy(value: unknown): NotificationPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('通知策略无效')
  const object = value as Record<string, unknown>
  const result = {} as NotificationPolicy
  for (const eventType of automationEventTypes) {
    const channels = object[eventType]
    if (
      !Array.isArray(channels) ||
      !channels.every((channel) =>
        ['windows', 'feishu', 'http'].includes(String(channel)),
      )
    )
      throw new Error(`通知策略无效：${eventType}`)
    result[eventType] = [...new Set(channels)] as NotificationChannelKind[]
  }
  return result
}

export interface NotificationHubOptions {
  readPolicy(): Promise<NotificationPolicy>
  resolveWebhook(
    kind: Exclude<NotificationChannelKind, 'windows'>,
  ): Promise<WebhookNotificationChannel | null>
  showNotification(title: string, body: string): Promise<void>
}

/**
 * Owns the single persistent dispatcher so dedup and per-channel circuit
 * state survive across messages; channels are resolved per dispatch so the
 * event-type policy always applies.
 */
export class NotificationHub {
  readonly #dispatcher: NotificationDispatcher
  readonly #options: NotificationHubOptions

  constructor(options: NotificationHubOptions) {
    this.#options = options
    this.#dispatcher = new NotificationDispatcher({
      channels: async (message) =>
        this.#resolveChannels(message.eventType as AutomationEventType),
    })
  }

  dispatch(message: NotificationMessage): Promise<Notification[]> {
    return this.#dispatcher.dispatch(message)
  }

  async #resolveChannels(
    eventType: AutomationEventType,
  ): Promise<NotificationChannel[]> {
    const enabled = new Set((await this.#options.readPolicy())[eventType])
    const channels: NotificationChannel[] = []
    if (enabled.has('windows'))
      channels.push(
        new WindowsNotificationChannel(async ({ title, body }) =>
          this.#options.showNotification(title, body),
        ),
      )
    for (const kind of ['feishu', 'http'] as const) {
      if (!enabled.has(kind)) continue
      const configured = await this.#options.resolveWebhook(kind)
      if (configured) channels.push(configured)
    }
    return channels
  }
}
