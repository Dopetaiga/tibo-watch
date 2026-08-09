import { describe, expect, it } from 'vitest'
import { renderEventReport } from '../../app/domain/report'
import type { Analysis, ResetEvent } from '../../app/domain/models'

describe('event report', () => {
  it('is rebuilt deterministically from JSON facts', () => {
    const base = {
      schemaVersion: 1 as const,
      createdAt: '2026-08-09T00:00:00Z',
      source: 'test',
      contentHash: 'a'.repeat(64),
    }
    const event = {
      ...base,
      eventId: 'e',
      postId: 'p',
      analysisVersion: 'a1',
      status: 'confirmed' as const,
      eventType: 'completed' as const,
      scope: 'Codex',
      expectedStart: null,
      expectedEnd: null,
      confirmedAt: base.createdAt,
      titleZh: '额度已重置',
    } satisfies ResetEvent
    const analysis = {
      ...base,
      postId: 'p',
      analysisVersion: 'a1',
      ruleVersion: 'rules-v1.0.0',
      promptVersion: 'prompt-v1',
      model: 'fixture',
      relevance: 'relevant' as const,
      eventType: 'completed' as const,
      scope: 'Codex',
      expectedWindow: { start: null, end: null, original: null },
      confidence: 'high' as const,
      translationZh: '已重置',
      summaryZh: '额度已完成重置。',
      evidence: ['原帖使用完成式'],
      uncertainties: [],
      sourceUrl: 'https://x.com/i/status/p',
      responseHash: 'b'.repeat(64),
    } satisfies Analysis
    expect(renderEventReport(event, analysis)).toBe(
      renderEventReport(event, analysis),
    )
    expect(renderEventReport(event, analysis)).toContain('额度已完成重置。')
  })
})
