import { describe, expect, it, vi } from 'vitest'
import {
  MultiProtocolProvider,
  parseJsonObject,
  parseStructuredAnalysis,
  RESET_ANALYSIS_SYSTEM_PROMPT,
  TIBO_TIME_PREDICTION_PRIOR,
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
  postedAt: '2026-08-12T06:20:37.000Z',
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
  it('uses a bounded Tibo expression prior with an evidence guard', () => {
    expect(RESET_ANALYSIS_SYSTEM_PROMPT).toContain('have now reset')
    expect(RESET_ANALYSIS_SYSTEM_PROMPT).toContain('there is still time')
    expect(RESET_ANALYSIS_SYSTEM_PROMPT).toContain('不能代替当前文本证据')
    expect(RESET_ANALYSIS_SYSTEM_PROMPT).toContain('不得仅凭作者风格补全承诺')
    expect(RESET_ANALYSIS_SYSTEM_PROMPT).toContain('America/Los_Angeles')
    expect(RESET_ANALYSIS_SYSTEM_PROMPT).toContain('Asia/Shanghai')
    expect(RESET_ANALYSIS_SYSTEM_PROMPT).toContain('start 和 end 区间')
    expect(TIBO_TIME_PREDICTION_PRIOR).toContain('不能直接套用中国自然日')
    expect(TIBO_TIME_PREDICTION_PRIOR).toContain('不得错误跳到再下一周')
    expect(TIBO_TIME_PREDICTION_PRIOR).toContain('两次独立重置')
    expect(RESET_ANALYSIS_SYSTEM_PROMPT.length).toBeLessThan(3400)
  })

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

  it('disables thinking for the official DeepSeek JSON classifier', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(analysis) } }],
        }),
        { status: 200 },
      ),
    )
    const provider = new MultiProtocolProvider(
      { ...base, baseUrl: 'https://api.deepseek.com' },
      fetchMock,
    )
    await provider.analyze(request, new AbortController().signal)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toMatchObject({
      model: 'model',
      max_tokens: 700,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    })
    expect(body.messages[0].content).toContain('合法 JSON 对象')
  })

  it.each([
    ['openai-chat', ['model', 'max_tokens', 'messages']],
    ['openai-responses', ['model', 'max_output_tokens', 'input']],
    ['anthropic-messages', ['model', 'max_tokens', 'system', 'messages']],
  ] as const)(
    'sends only portable required fields for custom %s providers',
    async (protocol, expectedKeys) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify(
            protocol === 'openai-chat'
              ? {
                  choices: [{ message: { content: JSON.stringify(analysis) } }],
                }
              : protocol === 'openai-responses'
                ? { output_text: JSON.stringify(analysis) }
                : {
                    content: [{ type: 'text', text: JSON.stringify(analysis) }],
                  },
          ),
          { status: 200 },
        ),
      )
      await new MultiProtocolProvider({ ...base, protocol }, fetchMock).analyze(
        request,
        new AbortController().signal,
      )
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
      expect(Object.keys(body).sort()).toEqual([...expectedKeys].sort())
      expect(body).not.toHaveProperty('temperature')
      expect(body).not.toHaveProperty('thinking')
      expect(body).not.toHaveProperty('response_format')
      expect(body).not.toHaveProperty('text')
    },
  )

  it('reports non-JSON model output without exposing its contents', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'We need to...' } }],
        }),
        { status: 200 },
      ),
    )
    await expect(
      new MultiProtocolProvider(base, fetchMock).analyze(
        request,
        new AbortController().signal,
      ),
    ).rejects.toThrow('响应未通过结构校验')
  })

  it('rejects verbose structured output that exceeds the compact contract', () => {
    expect(
      parseStructuredAnalysis(
        JSON.stringify({
          ...analysis,
          evidence: ['one', 'two', 'three'],
        }),
      ),
    ).toBeNull()
    expect(
      parseStructuredAnalysis(
        JSON.stringify({
          ...analysis,
          summaryZh: '长'.repeat(81),
        }),
      ),
    ).toBeNull()
  })

  it('extracts a valid JSON object after accidental reasoning text', () => {
    expect(
      parseJsonObject(`We need to classify this.\n${JSON.stringify(analysis)}`),
    ).toMatchObject({ eventType: 'completed' })
  })

  it('skips braces in reasoning text before the valid JSON object', () => {
    expect(
      parseJsonObject(
        `We should use {relevance, eventType} here.\n${JSON.stringify(analysis)}`,
      ),
    ).toMatchObject({ eventType: 'completed' })
  })

  it('does not accept prose without a valid JSON object', () => {
    expect(() => parseJsonObject('We need to classify this.')).toThrow(
      '未返回合法 JSON 对象',
    )
  })

  it.each([
    JSON.stringify(JSON.stringify(analysis)),
    JSON.stringify({ result: analysis }),
    JSON.stringify([analysis]),
  ])('safely unwraps structured analysis variants', (content) => {
    expect(parseStructuredAnalysis(content)).toMatchObject({
      eventType: 'completed',
    })
  })

  it('rejects insecure base URLs', () => {
    expect(
      () =>
        new MultiProtocolProvider({ ...base, baseUrl: 'http://example.test' }),
    ).toThrow('HTTPS')
  })

  it('rejects a full endpoint entered as Base URL', () => {
    expect(
      () =>
        new MultiProtocolProvider({
          ...base,
          baseUrl: 'https://api.deepseek.com/chat/completions',
        }),
    ).toThrow('不要包含')
  })
})
