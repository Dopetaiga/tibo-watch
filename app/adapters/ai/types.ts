export interface AnalysisRequest {
  postId: string
  postUrl: string
  text: string
  parentText: string | null
  quotedText: string | null
  ruleVersion: string
  matchedRuleIds: string[]
}

export interface StructuredAnalysis {
  relevance: 'relevant' | 'related_non_reset' | 'irrelevant'
  eventType: 'completed' | 'explicit_future' | 'vague_intent' | 'non_event'
  scope: string
  expectedWindow: {
    start: string | null
    end: string | null
    original: string | null
  }
  confidence: 'low' | 'medium' | 'high'
  translationZh: string
  summaryZh: string
  evidence: string[]
  uncertainties: string[]
  sourceUrl: string
}

export interface AnalysisProvider {
  readonly id: string
  readonly model: string
  analyze(
    request: AnalysisRequest,
    signal: AbortSignal,
  ): Promise<StructuredAnalysis>
  testConnection(signal: AbortSignal): Promise<{ ok: boolean; message: string }>
}

export function isStructuredAnalysis(
  value: unknown,
): value is StructuredAnalysis {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  const window = result.expectedWindow as Record<string, unknown> | null
  return (
    ['relevant', 'related_non_reset', 'irrelevant'].includes(
      String(result.relevance),
    ) &&
    ['completed', 'explicit_future', 'vague_intent', 'non_event'].includes(
      String(result.eventType),
    ) &&
    typeof result.scope === 'string' &&
    Boolean(window) &&
    ['low', 'medium', 'high'].includes(String(result.confidence)) &&
    typeof result.translationZh === 'string' &&
    typeof result.summaryZh === 'string' &&
    Array.isArray(result.evidence) &&
    result.evidence.every((item) => typeof item === 'string') &&
    Array.isArray(result.uncertainties) &&
    result.uncertainties.every((item) => typeof item === 'string') &&
    typeof result.sourceUrl === 'string'
  )
}
