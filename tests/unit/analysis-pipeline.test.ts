import { describe, expect, it, vi } from 'vitest'
import {
  AnalysisPipeline,
  type AnalysisCache,
} from '../../app/adapters/ai/pipeline'
import type { AnalysisProvider } from '../../app/adapters/ai/types'
import type { StructuredAnalysis } from '../../app/adapters/ai/types'
import type { Analysis } from '../../app/domain/models'

function fixtureProvider(): AnalysisProvider {
  const analyze = vi.fn(async (request): Promise<StructuredAnalysis> => ({
    relevance: 'relevant',
    eventType: 'explicit_future',
    scope: 'Codex',
    expectedWindow: { start: null, end: null, original: 'tomorrow' },
    confidence: 'high',
    translationZh: '明天重置。',
    summaryZh: '明确承诺明天重置。',
    evidence: ['will reset tomorrow'],
    uncertainties: [],
    sourceUrl: request.postUrl,
  }))
  return {
    id: 'fixture',
    model: 'fixture-model',
    analyze,
    testConnection: async () => ({ ok: true, message: 'ok' }),
  }
}

function fixtureCache(): AnalysisCache & { values: Map<string, Analysis> } {
  const values = new Map<string, Analysis>()
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => {
      values.set(key, value)
    },
  }
}

const request = {
  postId: '1',
  postUrl: 'https://x.com/thsottiaux/status/1',
  postedAt: '2026-08-12T06:20:37.000Z',
  text: 'We will reset tomorrow.',
  parentText: null,
  quotedText: null,
  ruleVersion: 'rules-v1.0.0',
  matchedRuleIds: ['rule'],
}
const noCandidate = {
  candidate: false,
  matchedRuleIds: [],
  reasons: [],
  inputHash: 'a',
  ruleVersion: 'rules-v1.0.0',
}
const candidate = { ...noCandidate, candidate: true, matchedRuleIds: ['rule'] }

describe('analysis pipeline', () => {
  it('makes zero AI calls for ordinary non-candidates', async () => {
    const provider = fixtureProvider()
    const result = await new AnalysisPipeline(provider, fixtureCache()).run(
      { request, ruleResult: noCandidate },
      new AbortController().signal,
    )
    expect(result.status).toBe('skipped_not_candidate')
    expect(provider.analyze).not.toHaveBeenCalled()
  })

  it('makes zero AI calls for cache hits', async () => {
    const provider = fixtureProvider()
    const cache = fixtureCache()
    const pipeline = new AnalysisPipeline(provider, cache)
    expect(
      (
        await pipeline.run(
          { request, ruleResult: candidate },
          new AbortController().signal,
        )
      ).status,
    ).toBe('analyzed')
    expect(
      (
        await pipeline.run(
          { request, ruleResult: candidate },
          new AbortController().signal,
        )
      ).status,
    ).toBe('cache_hit')
    expect(provider.analyze).toHaveBeenCalledTimes(1)
  })

  it('requires confirmation for manual analysis', async () => {
    const provider = fixtureProvider()
    const result = await new AnalysisPipeline(provider, fixtureCache()).run(
      { request, ruleResult: noCandidate, manual: true },
      new AbortController().signal,
    )
    expect(result.status).toBe('manual_confirmation_required')
    expect(provider.analyze).not.toHaveBeenCalled()
  })

  it('keeps bounded error evidence and never creates an analysis for invalid responses', async () => {
    const provider = fixtureProvider()
    provider.analyze = vi.fn(async () => {
      throw new Error('schema invalid')
    })
    const result = await new AnalysisPipeline(provider, fixtureCache(), 2).run(
      { request, ruleResult: candidate },
      new AbortController().signal,
    )
    expect(result).toMatchObject({ status: 'failed', analysis: null })
    expect(result.status === 'failed' && result.errors).toHaveLength(2)
  })
})
