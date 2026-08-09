import { describe, expect, it, vi } from 'vitest'
import { DeepSeekProvider } from '../../app/adapters/ai/deepseek'

describe('DeepSeek provider', () => {
  it('uses a content-free models request for connection tests', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    const provider = new DeepSeekProvider({
      apiKey: async () => 'secret-key',
      fetch: fetchMock,
    })
    expect(
      await provider.testConnection(new AbortController().signal),
    ).toMatchObject({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/models$/)
    expect(init?.body).toBeUndefined()
  })

  it('rejects missing structured fields', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"eventType":"completed"}' } }],
        }),
        { status: 200 },
      ),
    )
    const provider = new DeepSeekProvider({
      apiKey: async () => 'secret-key',
      fetch: fetchMock,
    })
    await expect(
      provider.analyze(
        {
          postId: '1',
          postUrl: 'https://x.com/i/status/1',
          text: 'reset',
          parentText: null,
          quotedText: null,
          ruleVersion: 'v1',
          matchedRuleIds: ['r'],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('结构校验')
  })
})
