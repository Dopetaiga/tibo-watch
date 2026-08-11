import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AnalysisPipeline } from '../../app/adapters/ai/pipeline'
import type { AnalysisProvider } from '../../app/adapters/ai/types'
import { NotificationDispatcher } from '../../app/adapters/notifications/dispatcher'
import type { NotificationChannel } from '../../app/adapters/notifications/types'
import { MonitoringPipeline } from '../../app/domain/monitoring-pipeline'
import type { Analysis, Post } from '../../app/domain/models'
import { evaluateRulesV1 } from '../../app/rules/rules-v1'
import { eventStatistics } from '../../app/renderer/src/dashboard-model'

function sink<T>() {
  const records: T[] = []
  return {
    records,
    put: async (record: T) => {
      records.push(record)
    },
  }
}

describe('complete monitoring pipeline', () => {
  it('runs post -> rules -> mock AI -> event -> notification -> dashboard', async () => {
    const provider: AnalysisProvider = {
      id: 'mock-ai',
      model: 'fixture-v1',
      testConnection: async () => ({ ok: true, message: 'ok' }),
      analyze: vi.fn(async (request) => ({
        relevance: 'relevant' as const,
        eventType: 'completed' as const,
        scope: 'Codex usage limits',
        expectedWindow: { start: null, end: null, original: 'already' },
        confidence: 'high' as const,
        translationZh: '我们已经重置了 Codex 用量。',
        summaryZh: 'Codex 用量重置已确认。',
        evidence: ['did reset the usage'],
        uncertainties: [],
        sourceUrl: request.postUrl,
      })),
    }
    const cache = new Map<string, Analysis>()
    const analysisPipeline = new AnalysisPipeline(provider, {
      get: async (key) => cache.get(key) ?? null,
      put: async (key, value) => void cache.set(key, value),
    })
    const channel: NotificationChannel = {
      id: 'windows',
      send: vi.fn(async () => ({
        channel: 'windows',
        ok: true,
        attemptedAt: '2026-08-11T00:00:01.000Z',
        statusCode: null,
        errorCode: null,
      })),
    }
    const posts = sink<Post>()
    const analyses = sink<Analysis>()
    const events =
      sink<Parameters<MonitoringPipeline['options']['events']['put']>[0]>()
    const notifications =
      sink<
        Parameters<
          MonitoringPipeline['options']['notificationRecords']['put']
        >[0]
      >()
    const pipeline = new MonitoringPipeline({
      analyze: analysisPipeline,
      notifications: new NotificationDispatcher({ channels: [channel] }),
      evaluate: (post) =>
        evaluateRulesV1({
          postId: post.postId,
          excerpt: post.text,
          contentHash: post.contentHash,
        }),
      posts,
      analyses,
      events,
      notificationRecords: notifications,
    })
    const post: Post = {
      schemaVersion: 1,
      createdAt: '2026-08-11T00:00:00.000Z',
      source: 'fixture',
      contentHash: createHash('sha256')
        .update('We did reset the usage for Codex.')
        .digest('hex'),
      postId: 'pipeline-1',
      url: 'https://x.com/thsottiaux/status/pipeline-1',
      author: 'thsottiaux',
      text: 'We did reset the usage for Codex.',
      postedAt: '2026-08-11T00:00:00.000Z',
      kind: 'original',
      parentPostId: null,
      quotedPostId: null,
    }

    const result = await pipeline.process(post, new AbortController().signal)

    expect(result.ruleResult.candidate).toBe(true)
    expect(provider.analyze).toHaveBeenCalledTimes(1)
    expect(result.event).toMatchObject({
      status: 'confirmed',
      resetKind: 'forced',
    })
    expect(result.notifications).toHaveLength(1)
    expect(result.notifications[0].status).toBe('sent')
    expect(posts.records).toHaveLength(1)
    expect(analyses.records).toHaveLength(1)
    expect(events.records).toHaveLength(1)
    expect(notifications.records).toHaveLength(1)
    expect(
      eventStatistics(
        events.records.map((event) => ({
          id: event.eventId,
          title: event.titleZh,
          type: event.resetKind,
          status: event.status === 'confirmed' ? 'confirmed' : 'expected',
          occurredAt: event.confirmedAt ?? event.createdAt,
          sourceUrl: post.url,
        })),
        new Date('2026-08-11T01:00:00.000Z'),
      ),
    ).toMatchObject({ all: 1, forced: 1 })
  })

  it('does not call AI, create events, or notify for an ordinary post', async () => {
    const provider = { analyze: vi.fn() }
    const analyze = {
      run: vi.fn(async () => ({
        status: 'skipped_not_candidate' as const,
        analysis: null,
      })),
    }
    const notifications = { dispatch: vi.fn() }
    const pipeline = new MonitoringPipeline({
      analyze,
      notifications,
      evaluate: (post) =>
        evaluateRulesV1({
          postId: post.postId,
          excerpt: post.text,
          contentHash: post.contentHash,
        }),
      posts: sink<Post>(),
      analyses: sink<Analysis>(),
      events: sink(),
      notificationRecords: sink(),
    })
    const post = {
      schemaVersion: 1 as const,
      createdAt: '2026-08-11T00:00:00.000Z',
      source: 'fixture',
      contentHash: 'a'.repeat(64),
      postId: 'ordinary',
      url: 'https://x.com/thsottiaux/status/ordinary',
      author: 'thsottiaux',
      text: 'Thanks for the feedback!',
      postedAt: '2026-08-11T00:00:00.000Z',
      kind: 'reply' as const,
      parentPostId: null,
      quotedPostId: null,
    }
    const result = await pipeline.process(post, new AbortController().signal)
    expect(result.ruleResult.candidate).toBe(false)
    expect(provider.analyze).not.toHaveBeenCalled()
    expect(result.event).toBeNull()
    expect(notifications.dispatch).not.toHaveBeenCalled()
  })
})
