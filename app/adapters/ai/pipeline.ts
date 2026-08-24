import { createHash } from 'node:crypto'
import type { Analysis } from '../../domain/models.js'
import type { RuleResult } from '../../rules/rules-v1.js'
import { DEEPSEEK_PROMPT_VERSION } from './deepseek.js'
import type { AnalysisProvider, AnalysisRequest } from './types.js'

export interface AnalysisCache {
  get(key: string): Promise<Analysis | null>
  put(key: string, analysis: Analysis): Promise<void>
}

export interface PipelineInput {
  request: AnalysisRequest
  ruleResult: RuleResult
  manual?: boolean
  manualConfirmed?: boolean
}

export type PipelineResult =
  | {
      status:
        | 'skipped_not_candidate'
        | 'skipped_ai_disabled'
        | 'manual_confirmation_required'
      analysis: null
    }
  | { status: 'cache_hit' | 'analyzed'; analysis: Analysis }
  | { status: 'failed'; analysis: null; errors: string[] }

export class AnalysisPipeline {
  constructor(
    readonly provider: AnalysisProvider,
    readonly cache: AnalysisCache,
    readonly maximumAttempts = 2,
    readonly retryBackoffMs = 1_000,
  ) {}

  async run(
    input: PipelineInput,
    signal: AbortSignal,
  ): Promise<PipelineResult> {
    if (
      !input.ruleResult.candidate &&
      !input.ruleResult.aiReviewRecommended &&
      !input.manual
    ) {
      return { status: 'skipped_not_candidate', analysis: null }
    }
    if (input.manual && !input.manualConfirmed) {
      return { status: 'manual_confirmation_required', analysis: null }
    }
    const analysisVersion = [
      input.ruleResult.ruleVersion,
      DEEPSEEK_PROMPT_VERSION,
      this.provider.model,
    ].join('--')
    const cacheKey = `${input.request.postId}--${analysisVersion}`
    const cached = await this.cache.get(cacheKey)
    if (cached) return { status: 'cache_hit', analysis: cached }

    const errors: string[] = []
    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      try {
        const structured = await this.provider.analyze(input.request, signal)
        const responseHash = createHash('sha256')
          .update(JSON.stringify(structured), 'utf8')
          .digest('hex')
        const analysis: Analysis = {
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          source: this.provider.id,
          contentHash: createHash('sha256')
            .update(
              `${input.request.postId}:${analysisVersion}:${responseHash}`,
              'utf8',
            )
            .digest('hex'),
          postId: input.request.postId,
          analysisVersion,
          ruleVersion: input.ruleResult.ruleVersion,
          promptVersion: DEEPSEEK_PROMPT_VERSION,
          model: this.provider.model,
          ...structured,
          responseHash,
        }
        await this.cache.put(cacheKey, analysis)
        return { status: 'analyzed', analysis }
      } catch (error) {
        errors.push(
          `attempt=${attempt} ${error instanceof Error ? error.message : String(error)}`,
        )
        // Deterministic failures and aborted calls never get a second try;
        // transient ones back off exponentially instead of hammering.
        if (attempt === this.maximumAttempts) break
        if (signal.aborted) break
        const message =
          error instanceof Error ? error.message : String(error)
        if (/HTTP (?:400|401|403|404)\b/.test(message)) break
        await new Promise((resolve) => {
          setTimeout(resolve, this.retryBackoffMs * 2 ** (attempt - 1))
        })
      }
    }
    return { status: 'failed', analysis: null, errors }
  }
}
