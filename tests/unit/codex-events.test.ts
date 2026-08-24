import { describe, expect, it } from 'vitest'
import { CodexAppServerClient } from '../../app/adapters/codex/app-server'
import {
  CodexConnectionManager,
  type LeasedClient,
} from '../../app/adapters/codex/connection'

interface Harness {
  client: CodexAppServerClient
  emit(method: string, params: unknown): void
  setStatus(next: string): void
}

function makeHarness(initialStatus = 'active'): Harness {
  let statusType: string = initialStatus
  const handlers = new Set<(method: string, params: unknown) => void>()
  const transport = {
    request<T>(method: string) {
      if (method === 'thread/read')
        return Promise.resolve({
          thread: { status: { type: statusType, activeFlags: [] } },
        }) as T
      if (method === 'account/read')
        return Promise.resolve({ account: { type: 'plus' } }) as T
      return Promise.resolve({}) as T
    },
    notify() {},
    onNotification(handler: (method: string, params: unknown) => void) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    close() {},
  }
  const client = new CodexAppServerClient(
    transport as unknown as ConstructorParameters<
      typeof CodexAppServerClient
    >[0],
  )
  return {
    client,
    emit(method, params) {
      for (const handler of handlers) handler(method, params)
    },
    setStatus(next: string) {
      statusType = next
    },
  }
}

describe('waitForTurnCompletion', () => {
  it('resolves from a pushed turn/completed notification without waiting the poll interval', async () => {
    const harness = makeHarness()
    const wait = harness.client.waitForTurnCompletion('t1', 'turn-1', {
      timeoutMs: 5_000,
      pollIntervalMs: 60_000,
    })
    setTimeout(() =>
      harness.emit('turn/completed', { threadId: 't1', turnId: 'turn-1' }),
    )
    await expect(wait).resolves.toBeUndefined()
  })

  it('ignores notifications for other threads or turns and falls back to polling', async () => {
    const harness = makeHarness('active')
    const wait = harness.client.waitForTurnCompletion('t1', 'turn-1', {
      timeoutMs: 2_000,
      pollIntervalMs: 30,
    })
    setTimeout(() => {
      harness.emit('turn/completed', { threadId: 'other', turnId: 'turn-x' })
      harness.emit('thread/status/changed', {
        threadId: 't1',
        status: { type: 'active' },
      })
    })
    setTimeout(() => harness.setStatus('idle'), 60)
    await expect(wait).resolves.toBeUndefined()
  })

  it('throws a timeout error when neither push nor polling observes completion', async () => {
    const harness = makeHarness('active')
    await expect(
      harness.client.waitForTurnCompletion('t1', 'turn-1', {
        timeoutMs: 150,
        pollIntervalMs: 30,
      }),
    ).rejects.toThrow('Codex turn 等待超时：turn-1')
  })

  it('reports activeFlags through onStatus while running', async () => {
    const harness = makeHarness('active')
    const statuses: string[] = []
    const wait = harness.client.waitForTurnCompletion('t1', 'turn-1', {
      timeoutMs: 2_000,
      pollIntervalMs: 20,
      onStatus: (status) => statuses.push(status.type),
    })
    setTimeout(() =>
      harness.emit('turn/failed', { threadId: 't1', turnId: 'turn-1' }),
    )
    await expect(wait).resolves.toBeUndefined()
    expect(statuses.length).toBeGreaterThan(0)
  })
})

class FakeClient {
  released = false
  closed = false
  readonly transport = {
    request: <T>(method: string) => {
      if (this.closed)
        return Promise.reject(new Error('child exited')) as Promise<T>
      return Promise.resolve(
        method === 'account/read' ? { account: { type: 'plus' } } : {},
      ) as Promise<T>
    },
    notify() {},
    close() {},
  }
  release() {
    this.released = true
  }
  close() {
    this.closed = true
  }
}

describe('CodexConnectionManager', () => {
  it('health-checks the pooled client and closes it after idle', async () => {
    let created = 0
    const manager = new CodexConnectionManager({
      executable: async () => 'codex-fake',
      idleCloseMs: 10,
      pingTimeoutMs: 100,
      connect: async () => {
        created += 1
        return new FakeClient() as unknown as never
      },
    })
    const first: LeasedClient = await manager.acquire()
    first.release()
    const second: LeasedClient = await manager.acquire()
    second.release()
    expect(created).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect((second.client as unknown as FakeClient).closed).toBe(true)
  })

  it('detects a dead pooled client on next acquire and rebuilds once', async () => {
    let created = 0
    const clients: FakeClient[] = []
    const manager = new CodexConnectionManager({
      executable: async () => 'codex-fake',
      pingTimeoutMs: 100,
      idleCloseMs: 60_000,
      connect: async () => {
        created += 1
        const client = new FakeClient()
        if (created === 1) client.close() // died between leases
        clients.push(client)
        return client as unknown as never
      },
    })
    const first: LeasedClient = await manager.acquire()
    first.release()
    const second: LeasedClient = await manager.acquire()
    second.release()
    expect(created).toBe(2)
    expect(clients[0].closed).toBe(true)
    expect((second.client as unknown as FakeClient).closed).toBe(false)
    await manager.closeNow()
  })
})
