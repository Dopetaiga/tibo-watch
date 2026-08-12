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

export const DEEPSEEK_PROVIDER_PRESET: Readonly<
  Pick<AiProviderConfig, 'protocol' | 'baseUrl' | 'model'>
> = {
  protocol: 'openai-chat',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
}

export const TIBO_EXPRESSION_PRIOR_VERSION = 'tibo-expression-prior-v3'
export const AI_MAX_OUTPUT_TOKENS = 700
export const TIBO_EXPRESSION_PRIOR = `Tibo 表达习惯先验（仅用于消歧，不能代替当前文本证据）：
- 已完成常见表达：have reset、have now reset、reset button pressed、added/credited a banked reset。
- 明确未来常见表达：will reset、reset incoming、should land/show in the next few hours、resetting in a bit。
- 动机常包装为庆祝里程碑、事故补偿、服务恢复或轻松玩笑；Enjoy、庆祝、惊喜或玩笑本身不构成重置证据。
- 短回复可能依赖父帖问题，例如 soon、there is still time；只有主帖确实回应父帖中的重置问题时才可判为模糊意向。
- 否定、拒绝、转述、引用或父帖中的 reset 不得脱离主帖意图触发事件。
- 任何判断都必须在 evidence 中引用当前输入可见的原文；若证据不足，选择 vague_intent 或 non_event，不得仅凭作者风格补全承诺。`

export const TIBO_TIME_PREDICTION_PRIOR = `Tibo 时间措辞预测先验（优先服从当前原文，不得用历史平均值覆盖明确时间）：
- "next hour"：以 postedAt 为起点，预测区间为随后 0 至 1 小时；"few minutes" 为随后 0 至 2 小时；"in a bit" 保守取随后 0 至 6 小时。
- "later today"、"tonight"、"tomorrow"：先在 America/Los_Angeles 中确定对应自然日，再把该自然日的起止边界转换为 Asia/Shanghai；不能直接套用中国自然日。
- "on Monday" 等星期表达：取 postedAt 之后最近的该星期自然日；若 postedAt 当天正是该星期且语义为未来，取当天剩余时段，不得错误跳到再下一周。
- "lands"、"propagating"、"should see it" 表示按钮可能已按下但到账仍有传播窗口；除非原文明确 have reset/reset button pressed，不得把传播承诺标为 completed。
- "little surprise tomorrow" 只有与同一帖中的明确 reset 承诺、里程碑承诺或当前上下文共同出现时才可判 explicit_future，并应降低置信度、保留歧义。
- 历史闭环只用于校验区间宽度，不得把两次独立重置之间的间隔当成承诺兑现时长。`

export const RESET_ANALYSIS_SYSTEM_PROMPT = `你是重置事件分类器。只返回一个合法 JSON 对象，不要返回 Markdown、解释、推理过程或 JSON 之外的任何文本。区分已完成、明确未来、模糊意向和非事件。父帖与引用仅用于消歧，不得让父帖关键词脱离主帖意向触发事件。postedAt 是原帖发布时间。作者 Tibo 的时间表述按美国太平洋时区 America/Los_Angeles 理解（含夏令时），tomorrow、tonight、later today 等相对时间必须以 postedAt 为锚点计算。explicit_future 必须给出合理的 start 和 end 区间，不得只给单一时刻；若原文不精确，应根据措辞给出保守区间并在 uncertainties 说明。expectedWindow.start/end 必须转换为中国标准时间 Asia/Shanghai，并输出带 +08:00 偏移的 ISO 8601 时间。

${TIBO_EXPRESSION_PRIOR}
${TIBO_TIME_PREDICTION_PRIOR}

输出必须紧凑：translationZh 仅忠实翻译当前主帖且不扩写；summaryZh 最多 40 个汉字；scope 最多 30 个字符；evidence 只摘录当前输入原文中最关键的 1 至 2 个短句，不得复述翻译；uncertainties 最多 2 条，每条最多 40 个汉字，无不确定性则返回空数组。不要解释分类规则。

严格使用以下 JSON 结构和枚举：
{"relevance":"relevant|related_non_reset|irrelevant","eventType":"completed|explicit_future|vague_intent|non_event","scope":"string","expectedWindow":{"start":"ISO 8601 or null","end":"ISO 8601 or null","original":"string or null"},"confidence":"low|medium|high","translationZh":"string","summaryZh":"string","evidence":["string"],"uncertainties":["string"],"sourceUrl":"必须原样复制输入 postUrl"}`

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
    this.id = `${config.protocol}:${TIBO_EXPRESSION_PRIOR_VERSION}`
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
    const result = parseStructuredAnalysis(content)
    if (!result) throw new Error('AI Provider 响应未通过结构校验')
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
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        system: RESET_ANALYSIS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: user }],
      }
    if (this.#config.protocol === 'openai-responses')
      return {
        model: this.model,
        max_output_tokens: AI_MAX_OUTPUT_TOKENS,
        input: [
          { role: 'system', content: RESET_ANALYSIS_SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
      }
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: AI_MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: RESET_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
    }
    if (isOfficialDeepSeek(this.#config)) {
      body.temperature = 0
      body.response_format = { type: 'json_object' }
      body.thinking = { type: 'disabled' }
    }
    return body
  }
}

function isOfficialDeepSeek(config: AiProviderConfig): boolean {
  const url = new URL(config.baseUrl)
  return (
    config.protocol === DEEPSEEK_PROVIDER_PRESET.protocol &&
    url.hostname === 'api.deepseek.com' &&
    url.pathname.replace(/\/$/, '') === ''
  )
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
  const endpointSuffix = {
    'anthropic-messages': '/messages',
    'openai-responses': '/responses',
    'openai-chat': '/chat/completions',
  }[config.protocol]
  if (url.pathname.replace(/\/$/, '').endsWith(endpointSuffix))
    throw new Error(`Base URL 不要包含 ${endpointSuffix}，程序会自动追加端点`)
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

export function parseJsonObject(content: string): unknown {
  const cleaned = stripCodeFence(content)
  try {
    return JSON.parse(cleaned) as unknown
  } catch {
    for (const candidate of jsonObjectCandidates(cleaned)) {
      try {
        return JSON.parse(candidate) as unknown
      } catch {
        // Continue to the next balanced object.
      }
    }
    throw new Error('AI Provider 未返回合法 JSON 对象')
  }
}

export function parseStructuredAnalysis(
  content: string,
): StructuredAnalysis | null {
  const cleaned = stripCodeFence(content)
  try {
    const value: unknown = JSON.parse(cleaned)
    const structured = findStructuredAnalysis(value)
    if (structured) return structured
    if (typeof value === 'string' && value !== cleaned)
      return parseStructuredAnalysis(value)
  } catch {
    // Try balanced objects below.
  }
  for (const candidate of jsonObjectCandidates(cleaned)) {
    try {
      const value: unknown = JSON.parse(candidate)
      const structured = findStructuredAnalysis(value)
      if (structured) return structured
    } catch {
      // Continue to the next balanced object.
    }
  }
  return null
}

function findStructuredAnalysis(
  value: unknown,
  depth = 0,
): StructuredAnalysis | null {
  if (isStructuredAnalysis(value)) return value
  if (depth >= 2 || !value || typeof value !== 'object') return null
  const children = Array.isArray(value)
    ? value
    : Object.entries(value as Record<string, unknown>)
        .filter(([key]) =>
          ['analysis', 'result', 'output', 'data'].includes(key),
        )
        .map(([, child]) => child)
  for (const child of children) {
    const structured = findStructuredAnalysis(child, depth + 1)
    if (structured) return structured
  }
  return null
}

function jsonObjectCandidates(value: string): string[] {
  const candidates: string[] = []
  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== '{') continue
    let depth = 0
    let quoted = false
    let escaped = false
    for (let index = start; index < value.length; index += 1) {
      const character = value[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') quoted = false
        continue
      }
      if (character === '"') quoted = true
      else if (character === '{') depth += 1
      else if (character === '}' && --depth === 0) {
        candidates.push(value.slice(start, index + 1))
        break
      }
    }
  }
  return candidates
}
function protocolLabel(value: AiProtocol): string {
  return {
    'anthropic-messages': 'Messages API',
    'openai-responses': 'Responses API',
    'openai-chat': 'Chat Completions API',
  }[value]
}
