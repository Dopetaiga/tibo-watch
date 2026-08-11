import { describe, expect, it, vi } from 'vitest'
import {
  MultiProtocolProvider,
  type AiProviderConfig,
} from '../../app/adapters/ai/multi-protocol'

const analysis = {
  relevance: 'relevant',
  eventType: 'completed',
  scope: 'Codex',
  expectedWindow: { start: null, end: null, original: null },
  confidence: 'high',
  translationZh: '已重置',
  summaryZh: '已完成重置',
  evidence: ['reset'],
  uncertainties: [],
  sourceUrl: 'https://x.com/i/status/1',
}
const request = {
  postId: '1',
  postUrl: analysis.sourceUrl,
  text: 'reset',
  parentText: null,
  quotedText: null,
  ruleVersion: 'v1',
  matchedRuleIds: ['r'],
}
const base: AiProviderConfig = {
  protocol: 'openai-chat',
  baseUrl: 'https://example.test/v1',
  model: 'model',
  apiKey: 'secret-key',
  headers: {},
}

describe('multi-protocol AI provider', () => {
  it.each([
    [
      'openai-chat',
      { choices: [{ message: { content: JSON.stringify(analysis) } }] },
      '/chat/completions',
    ],
    [
      'openai-responses',
      { output_text: JSON.stringify(analysis) },
      '/responses',
    ],
    [
      'anthropic-messages',
      { content: [{ type: 'text', text: JSON.stringify(analysis) }] },
      '/messages',
    ],
  ] as const)('normalizes %s responses', async (protocol, payload, path) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
    const provider = new MultiProtocolProvider({ ...base, protocol }, fetchMock)
    await expect(
      provider.analyze(request, new AbortController().signal),
    ).resolves.toMatchObject({ eventType: 'completed' })
    expect(String(fetchMock.mock.calls[0][0]).endsWith(path)).toBe(true)
  })

  it('tests credentials without sending post content', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    const provider = new MultiProtocolProvider(base, fetchMock)
    await provider.testConnection(new AbortController().signal)
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
  })

  it('rejects insecure base URLs', () => {
    expect(
      () =>
        new MultiProtocolProvider({ ...base, baseUrl: 'http://example.test' }),
    ).toThrow('HTTPS')
  })
})
