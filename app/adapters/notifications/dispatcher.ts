import { createHash } from 'node:crypto'
import type { Notification } from '../../domain/models.js'
import type {
  NotificationChannel,
  NotificationDelivery,
  NotificationMessage,
} from './types.js'

interface ChannelState {
  failures: number
  openUntil: number
}

export type NotificationChannels =
  | NotificationChannel[]
  | ((
      message: NotificationMessage,
    ) => Promise<NotificationChannel[]> | NotificationChannel[])

export interface DispatcherOptions {
  channels: NotificationChannels
  timeoutMs?: number
  maximumAttempts?: number
  circuitFailureThreshold?: number
  circuitCooldownMs?: number
  now?: () => number
}

export class NotificationDispatcher {
  readonly #options: Required<Omit<DispatcherOptions, 'channels'>> &
    Pick<DispatcherOptions, 'channels'>
  readonly #delivered = new Set<string>()
  readonly #states = new Map<string, ChannelState>()

  constructor(options: DispatcherOptions) {
    this.#options = {
      channels: options.channels,
      timeoutMs: options.timeoutMs ?? 15_000,
      maximumAttempts: options.maximumAttempts ?? 2,
      circuitFailureThreshold: options.circuitFailureThreshold ?? 3,
      circuitCooldownMs: options.circuitCooldownMs ?? 15 * 60_000,
      now: options.now ?? Date.now,
    }
  }

  async dispatch(message: NotificationMessage): Promise<Notification[]> {
    const channels = await this.#resolveChannels(message)
    return Promise.all(
      channels.map((channel) => this.#dispatchChannel(channel, message)),
    )
  }

  async #resolveChannels(
    message: NotificationMessage,
  ): Promise<NotificationChannel[]> {
    const channels = this.#options.channels
    return typeof channels === 'function' ? await channels(message) : channels
  }

  async #dispatchChannel(
    channel: NotificationChannel,
    message: NotificationMessage,
  ): Promise<Notification> {
    const key = `${message.eventId}:${channel.id}:${message.semanticVersion}:${message.isTest}`
    if (this.#delivered.has(key))
      return record(channel.id, message, 'suppressed', null)
    const state = this.#states.get(channel.id) ?? { failures: 0, openUntil: 0 }
    if (state.openUntil > this.#options.now())
      return record(channel.id, message, 'suppressed', 'CIRCUIT_OPEN')

    let last: NotificationDelivery | null = null
    for (
      let attempt = 0;
      attempt < this.#options.maximumAttempts;
      attempt += 1
    ) {
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(new Error('notification timeout')),
        this.#options.timeoutMs,
      )
      try {
        last = await channel.send(message, controller.signal)
      } catch (error) {
        last = {
          channel: channel.id,
          ok: false,
          attemptedAt: new Date().toISOString(),
          statusCode: null,
          errorCode:
            error instanceof Error ? error.name : 'CHANNEL_UNEXPECTED_ERROR',
        }
      } finally {
        clearTimeout(timeout)
      }
      if (last.ok) {
        this.#delivered.add(key)
        this.#states.set(channel.id, { failures: 0, openUntil: 0 })
        return record(channel.id, message, 'sent', null, last.attemptedAt)
      }
    }

    const failures = state.failures + 1
    this.#states.set(channel.id, {
      failures,
      openUntil:
        failures >= this.#options.circuitFailureThreshold
          ? this.#options.now() + this.#options.circuitCooldownMs
          : 0,
    })
    return record(channel.id, message, 'failed', last?.errorCode ?? 'UNKNOWN')
  }
}

function record(
  channel: NotificationChannel['id'],
  message: NotificationMessage,
  status: Notification['status'],
  errorCode: string | null,
  attemptedAt: string | null = new Date().toISOString(),
): Notification {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    source: 'notification-dispatcher',
    contentHash: createHash('sha256')
      .update(
        `${message.eventId}:${channel}:${message.semanticVersion}:${status}:${message.isTest}`,
        'utf8',
      )
      .digest('hex'),
    notificationId: `${message.eventId}--${channel}--${message.semanticVersion}--${message.isTest ? 'test' : 'real'}`,
    eventId: message.eventId,
    channel,
    semanticVersion: message.semanticVersion,
    status,
    attemptedAt,
    errorCode,
    isTest: message.isTest,
  }
}
