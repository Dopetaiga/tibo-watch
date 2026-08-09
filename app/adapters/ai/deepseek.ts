import type {
  AnalysisProvider,
  AnalysisRequest,
  StructuredAnalysis,
} from './types.js'
import { isStructuredAnalysis } from './types.js'

const systemPrompt = `你是重置事件分类器。只返回 JSON，不返回 Markdown。区分已完成、明确未来、模糊意向和非事件。父帖与引用仅用于消歧，不得让父帖关键词脱离主帖意向触发事件。输出中文翻译、摘要、证据和不确定性。`

export interface DeepSeekOptions {
  apiKey: () => Promise<string>
  baseUrl?: string
  model?: string
  fetch?: typeof fetch
}

export class DeepSeekProvider implements AnalysisProvider {
  readonly id = 'deepseek-openai-compatible'
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
    this.model = options.model ?? 'deepseek-chat'
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
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
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
    const result: unknown = JSON.parse(content)
    if (!isStructuredAnalysis(result))
      throw new Error('DeepSeek 响应未通过结构校验')
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

export const DEEPSEEK_PROMPT_VERSION = 'deepseek-reset-v1'
