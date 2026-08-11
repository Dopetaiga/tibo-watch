import { describe, expect, it, vi } from 'vitest'
import { NotificationDispatcher } from '../../app/adapters/notifications/dispatcher'
import type {
  NotificationChannel,
  NotificationMessage,
} from '../../app/adapters/notifications/types'
import { WebhookNotificationChannel } from '../../app/adapters/notifications/webhook'
import { WindowsNotificationChannel } from '../../app/adapters/notifications/windows'

const message: NotificationMessage = {
  schemaVersion: 1,
  eventType: 'ai_confirmed',
  eventId: 'event-1',
  semanticVersion: 'v1',
  title: 'Codex 额度重置',
  summaryZh: '额度将在一小时内重置。',
  expectedWindow: '一小时内',
  uncertainties: ['传播可能有延迟'],
  sourceUrl: 'https://x.com/thsottiaux/status/1',
  isTest: false,
}

function channel(
  id: NotificationChannel['id'],
  ok: boolean,
): NotificationChannel {
  return {
    id,
    send: vi.fn(async () => ({
      channel: id,
      ok,
      attemptedAt: '2026-08-09T00:00:00Z',
      statusCode: ok ? 200 : 500,
      errorCode: ok ? null : 'HTTP_500',
    })),
  }
}

describe('notification dispatcher', () => {
  it('isolates channel failure and sends each semantic version once', async () => {
    const windows = channel('windows', true)
    const http = channel('http', false)
    const dispatcher = new NotificationDispatcher({
      channels: [windows, http],
      maximumAttempts: 1,
    })
    expect(
      (await dispatcher.dispatch(message)).map(({ status }) => status),
    ).toEqual(['sent', 'failed'])
    expect((await dispatcher.dispatch(message))[0].status).toBe('suppressed')
    await dispatcher.dispatch({ ...message, semanticVersion: 'v2' })
    expect(windows.send).toHaveBeenCalledTimes(2)
  })

  it('opens a per-channel circuit without blocking other channels', async () => {
    const http = channel('http', false)
    const windows = channel('windows', true)
    const dispatcher = new NotificationDispatcher({
      channels: [http, windows],
      maximumAttempts: 1,
      circuitFailureThreshold: 1,
      now: () => 1_000,
    })
    await dispatcher.dispatch(message)
    const second = await dispatcher.dispatch({
      ...message,
      semanticVersion: 'v2',
    })
    expect(second.map(({ status }) => status)).toEqual(['suppressed', 'sent'])
    expect(second[0].errorCode).toBe('CIRCUIT_OPEN')
  })

  it('marks test notifications so they cannot enter real event statistics', async () => {
    const dispatcher = new NotificationDispatcher({
      channels: [channel('windows', true)],
    })
    const [result] = await dispatcher.dispatch({ ...message, isTest: true })
    expect(result.isTest).toBe(true)
    expect(result.notificationId).toContain('--test')
  })
})

describe('notification channels', () => {
  it('renders a Windows notification with Chinese evidence', async () => {
    const show = vi.fn(
      async (options: { title: string; body: string; sourceUrl: string }) => {
        void options
      },
    )
    const result = await new WindowsNotificationChannel(show).send(message)
    expect(result.ok).toBe(true)
    expect(show.mock.calls[0][0].body).toContain('传播可能有延迟')
  })

  it('formats Feishu payloads and keeps webhook credentials out of the body', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    const feishu = new WebhookNotificationChannel({
      id: 'feishu',
      url: async () =>
        'https://open.feishu.cn/open-apis/bot/v2/hook/secret-token',
      fetch: fetchMock,
    })
    expect((await feishu.send(message, new AbortController().signal)).ok).toBe(
      true,
    )
    const body = String(fetchMock.mock.calls[0][1]?.body)
    expect(body).toContain('msg_type')
    expect(body).not.toContain('secret-token')
  })

  it('wraps generic HTTP payloads in a versioned event envelope', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    const http = new WebhookNotificationChannel({
      id: 'http',
      url: async () => 'https://example.test/hook',
      fetch: fetchMock,
    })
    await http.send(message, new AbortController().signal)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<
      string,
      unknown
    >
    expect(body).toMatchObject({
      schema: 'dev.tibowatch.event',
      schemaVersion: 1,
      eventType: 'ai_confirmed',
    })
    expect(body.idempotencyKey).toContain('event-1')
  })
})
