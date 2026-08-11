import type {
  AnalysisProvider,
  AnalysisRequest,
  StructuredAnalysis,
} from './types.js'
import { isStructuredAnalysis } from './types.js'

export type AiProtocol =
  'anthropic-messages' | 'openai-responses' | 'openai-chat'

export interface AiProviderConfig {
  protocol: AiProtocol
  baseUrl: string
  model: string
  apiKey: string
  headers: Record<string, string>
}

const systemPrompt = `你是重置事件分类器。只返回 JSON，不返回 Markdown。区分已完成、明确未来、模糊意向和非事件。父帖与引用仅用于消歧，不得让父帖关键词脱离主帖意向触发事件。输出 relevance、eventType、scope、expectedWindow、confidence、translationZh、summaryZh、evidence、uncertainties 和 sourceUrl。`

export class MultiProtocolProvider implements AnalysisProvider {
  readonly id: string
  readonly model: string
  readonly #config: AiProviderConfig
  readonly #fetch: typeof fetch

  constructor(
    config: AiProviderConfig,
    fetchImplementation: typeof fetch = fetch,
  ) {
    validateAiProviderConfig(config)
    this.#config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      headers: { ...config.headers },
    }
    this.id = config.protocol
    this.model = config.model
    this.#fetch = fetchImplementation
  }

  async analyze(
    request: AnalysisRequest,
    signal: AbortSignal,
  ): Promise<StructuredAnalysis> {
    const response = await this.#fetch(this.#endpoint(), {
      method: 'POST',
      signal,
      headers: this.#headers(),
      body: JSON.stringify(this.#body(request)),
    })
    if (!response.ok)
      throw new Error(`AI Provider 返回 HTTP ${response.status}`)
    const payload: unknown = await response.json()
    const content = extractText(this.#config.protocol, payload)
    const result: unknown = JSON.parse(stripCodeFence(content))
    if (!isStructuredAnalysis(result))
      throw new Error('AI Provider 响应未通过结构校验')
    if (result.sourceUrl !== request.postUrl)
      throw new Error('AI Provider 响应原帖链接不匹配')
    return result
  }

  async testConnection(
    signal: AbortSignal,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await this.#fetch(`${this.#config.baseUrl}/models`, {
        signal,
        headers: this.#headers(false),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return {
        ok: true,
        message: `${protocolLabel(this.#config.protocol)} 连接正常`,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '连接失败',
      }
    }
  }

  #endpoint(): string {
    return `${this.#config.baseUrl}/${({ 'anthropic-messages': 'messages', 'openai-responses': 'responses', 'openai-chat': 'chat/completions' } as const)[this.#config.protocol]}`
  }

  #headers(json = true): Record<string, string> {
    const auth: Record<string, string> =
      this.#config.protocol === 'anthropic-messages'
        ? {
            'x-api-key': this.#config.apiKey,
            'anthropic-version': '2023-06-01',
          }
        : { authorization: `Bearer ${this.#config.apiKey}` }
    return {
      ...auth,
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...this.#config.headers,
    }
  }

  #body(request: AnalysisRequest): Record<string, unknown> {
    const user = JSON.stringify(request)
    if (this.#config.protocol === 'anthropic-messages')
      return {
        model: this.model,
        max_tokens: 1600,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: user }],
      }
    if (this.#config.protocol === 'openai-responses')
      return {
        model: this.model,
        temperature: 0,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: user },
        ],
        text: { format: { type: 'json_object' } },
      }
    return {
      model: this.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: user },
      ],
    }
  }
}

export function validateAiProviderConfig(config: AiProviderConfig): void {
  if (
    !['anthropic-messages', 'openai-responses', 'openai-chat'].includes(
      config.protocol,
    )
  )
    throw new Error('AI 协议无效')
  const url = new URL(config.baseUrl)
  if (url.protocol !== 'https:') throw new Error('AI Base URL 必须使用 HTTPS')
  if (!config.model.trim() || config.model.length > 200)
    throw new Error('AI 模型名称无效')
  if (config.apiKey.trim().length < 8) throw new Error('AI API Key 格式无效')
  for (const [name, value] of Object.entries(config.headers)) {
    if (
      !/^[A-Za-z0-9-]{1,64}$/.test(name) ||
      /^(host|content-length)$/i.test(name)
    )
      throw new Error(`不允许的 AI 请求头：${name}`)
    if (typeof value !== 'string' || value.length > 4096)
      throw new Error(`AI 请求头值无效：${name}`)
  }
}

function extractText(protocol: AiProtocol, payload: unknown): string {
  const value = payload as Record<string, unknown>
  if (protocol === 'anthropic-messages') {
    const content = value.content as
      Array<{ type?: string; text?: string }> | undefined
    const text = content?.find((item) => item.type === 'text')?.text
    if (text) return text
  } else if (protocol === 'openai-responses') {
    if (typeof value.output_text === 'string') return value.output_text
    const output = value.output as
      Array<{ content?: Array<{ text?: string }> }> | undefined
    const text = output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => typeof item.text === 'string')?.text
    if (text) return text
  } else {
    const choices = value.choices as
      Array<{ message?: { content?: string } }> | undefined
    const text = choices?.[0]?.message?.content
    if (text) return text
  }
  throw new Error('AI Provider 响应缺少文本内容')
}

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
}
function protocolLabel(value: AiProtocol): string {
  return {
    'anthropic-messages': 'Messages API',
    'openai-responses': 'Responses API',
    'openai-chat': 'Chat Completions API',
  }[value]
}
