import { describe, expect, it, vi } from 'vitest'
import {
  CodexAppServerClient,
  resolveCodexExecutable,
  type JsonRpcTransport,
} from '../../app/adapters/codex/app-server'

function transport(results: Record<string, unknown>): JsonRpcTransport {
  return {
    request: vi.fn(
      async (method: string) => results[method],
    ) as JsonRpcTransport['request'],
    notify: vi.fn(),
    close: vi.fn(),
  }
}

describe('Codex App Server client', () => {
  it('honors an explicitly configured executable for portable environments', async () => {
    await expect(resolveCodexExecutable(process.execPath)).resolves.toBe(
      process.execPath,
    )
  })

  it('parses the dual-window 5h+weekly payload with credits and plan metadata', async () => {
    const rpc = transport({
      'account/rateLimits/read': {
        rateLimits: {
          limitId: 'codex',
          planType: 'plus',
          spendControlReached: false,
          credits: { hasCredits: false, unlimited: false, balance: '0' },
          primary: {
            usedPercent: 4,
            windowDurationMins: 300,
            resetsAt: 1787748401, // seconds → normalized to ms
          },
          secondary: {
            usedPercent: 1,
            windowDurationMins: 10080,
            resetsAt: 1788335201,
          },
        },
        rateLimitsByLimitId: {},
      },
    })
    const client = new CodexAppServerClient(rpc)
    await expect(client.rateLimits()).resolves.toMatchObject({
      usedPercent: 4,
      windowDurationMins: 300,
      resetsAt: 1787748401_000,
      secondary: {
        usedPercent: 1,
        windowDurationMins: 10080,
        resetsAt: 1788335201_000,
      },
      creditsBalance: '0',
      unlimited: false,
      spendControlReached: false,
      planType: 'plus',
    })
  })

  it('keeps secondary null on legacy single-window payloads', async () => {
    const rpc = transport({
      'account/rateLimits/read': {
        rateLimits: { primary: { usedPercent: 10 } },
      },
    })
    const client = new CodexAppServerClient(rpc)
    const snapshot = await client.rateLimits()
    expect(snapshot.secondary).toBeNull()
    expect(snapshot.unlimited).toBeNull()
    expect(snapshot.usedPercent).toBe(10)
  })

  it('performs the required initialization handshake', async () => {
    const rpc = transport({ initialize: {} })
    const client = new CodexAppServerClient(rpc)
    await client.initialize()
    expect(rpc.request).toHaveBeenCalledWith(
      'initialize',
      expect.objectContaining({
        clientInfo: expect.objectContaining({ name: 'tibo_watch' }),
      }),
    )
    expect(rpc.notify).toHaveBeenCalledWith('initialized')
  })

  it('keeps reset-credit expiry details from the account response', async () => {
    const rpc = transport({
      'account/rateLimits/read': {
        rateLimits: { primary: { usedPercent: 75 } },
        rateLimitResetCredits: {
          availableCount: 1,
          credits: [
            {
              id: 'credit-1',
              grantedAt: 100,
              expiresAt: 200,
              status: 'available',
              resetType: 'codexRateLimits',
              title: 'Celebration reset',
              description: null,
            },
          ],
        },
      },
    })
    const client = new CodexAppServerClient(rpc)
    await expect(client.rateLimits()).resolves.toMatchObject({
      availableResetCredits: 1,
      resetCredits: [
        {
          id: 'credit-1',
          grantedAt: 100_000,
          expiresAt: 200_000,
          status: 'available',
        },
      ],
    })
  })

  it('refuses to touch an already active thread', async () => {
    const rpc = transport({
      'thread/read': { thread: { status: { type: 'active' } } },
    })
    const client = new CodexAppServerClient(rpc)
    await expect(client.resumeThread('thr_active')).rejects.toThrow('正在运行')
    expect(rpc.request).not.toHaveBeenCalledWith(
      'thread/resume',
      expect.anything(),
    )
    expect(rpc.request).not.toHaveBeenCalledWith(
      'turn/start',
      expect.anything(),
    )
  })

  it('resumes an idle thread without overriding cwd or sandbox', async () => {
    const rpc = transport({
      'thread/read': { thread: { status: { type: 'idle' } } },
      'thread/resume': { thread: { id: 'thr_idle' } },
      'turn/start': { turn: { id: 'turn_1' } },
    })
    const client = new CodexAppServerClient(rpc)
    await expect(client.resumeThread('thr_idle')).resolves.toEqual({
      turnId: 'turn_1',
    })
    const call = vi
      .mocked(rpc.request)
      .mock.calls.find(([method]) => method === 'turn/start')
    expect(call?.[1]).not.toHaveProperty('cwd')
    expect(call?.[1]).not.toHaveProperty('sandboxPolicy')
  })

  it('injects an explicitly configured acceleration instruction', async () => {
    const rpc = transport({
      'thread/read': { thread: { status: { type: 'idle' } } },
      'thread/resume': { thread: { id: 'thr_idle' } },
      'turn/start': { turn: { id: 'turn_2' } },
    })
    const client = new CodexAppServerClient(rpc)
    await client.resumeThread('thr_idle', '提高推理强度并继续当前目标。')
    expect(rpc.request).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({
        input: [{ type: 'text', text: '提高推理强度并继续当前目标。' }],
      }),
    )
  })

  it('keeps the app server alive until the started turn is no longer active', async () => {
    const rpc = transport({})
    vi.mocked(rpc.request)
      .mockResolvedValueOnce({ thread: { status: { type: 'active' } } })
      .mockResolvedValueOnce({ thread: { status: { type: 'idle' } } })
    const client = new CodexAppServerClient(rpc)

    await expect(
      client.waitForTurnCompletion('thr_idle', 'turn_1', {
        timeoutMs: 100,
        pollIntervalMs: 1,
      }),
    ).resolves.toBeUndefined()
    expect(rpc.request).toHaveBeenCalledTimes(2)
  })
})
