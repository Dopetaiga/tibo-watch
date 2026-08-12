import type {
  AnalysisProvider,
  AnalysisRequest,
  StructuredAnalysis,
} from './types.js'
import {
  parseStructuredAnalysis,
  AI_MAX_OUTPUT_TOKENS,
  RESET_ANALYSIS_SYSTEM_PROMPT,
  TIBO_EXPRESSION_PRIOR_VERSION,
} from './multi-protocol.js'

export interface DeepSeekOptions {
  apiKey: () => Promise<string>
  baseUrl?: string
  model?: string
  fetch?: typeof fetch
}

export class DeepSeekProvider implements AnalysisProvider {
  readonly id = `deepseek-openai-compatible:${TIBO_EXPRESSION_PRIOR_VERSION}`
  readonly model: string
  readonly #apiKey: () => Promise<string>
  readonly #baseUrl: string
  readonly #fetch: typeof fetch

  constructor(options: DeepSeekOptions) {
    this.#apiKey = options.apiKey
    this.#baseUrl = (options.baseUrl ?? 'https://api.deepseek.com').replace(
      /\/$/,
      '',
    )
    this.model = options.model ?? 'deepseek-v4-flash'
    this.#fetch = options.fetch ?? fetch
  }

  async analyze(
    request: AnalysisRequest,
    signal: AbortSignal,
  ): Promise<StructuredAnalysis> {
    const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        authorization: `Bearer ${await this.#apiKey()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: RESET_ANALYSIS_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(request) },
        ],
      }),
    })
    if (!response.ok) throw new Error(`DeepSeek 返回 HTTP ${response.status}`)
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('DeepSeek 响应缺少 message.content')
    const result = parseStructuredAnalysis(content)
    if (!result) throw new Error('DeepSeek 响应未通过结构校验')
    if (result.sourceUrl !== request.postUrl)
      throw new Error('DeepSeek 响应原帖链接不匹配')
    return result
  }

  async testConnection(
    signal: AbortSignal,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await this.#fetch(`${this.#baseUrl}/models`, {
        signal,
        headers: { authorization: `Bearer ${await this.#apiKey()}` },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return { ok: true, message: 'DeepSeek 连接正常' }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '连接失败',
      }
    }
  }
}

export const DEEPSEEK_PROMPT_VERSION = 'deepseek-reset-v6'
