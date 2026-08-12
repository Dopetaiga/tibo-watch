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
})
