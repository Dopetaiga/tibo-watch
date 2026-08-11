import { createHash } from 'node:crypto'
import type {
  AnalysisPipeline,
  PipelineResult,
} from '../adapters/ai/pipeline.js'
import type { NotificationDispatcher } from '../adapters/notifications/dispatcher.js'
import type { NotificationMessage } from '../adapters/notifications/types.js'
import type { RuleResult } from '../rules/rules-v1.js'
import type { Analysis, Notification, Post, ResetEvent } from './models.js'

export interface FactSink<T> {
  put(record: T): Promise<unknown>
}

export interface MonitoringPipelineOptions {
  analyze: Pick<AnalysisPipeline, 'run'>
  notifications: Pick<NotificationDispatcher, 'dispatch'>
  evaluate(post: Post): RuleResult
  posts: FactSink<Post>
  analyses: FactSink<Analysis>
  events: FactSink<ResetEvent>
  notificationRecords: FactSink<Notification>
  eventAutomation?: {
    onEvent(
      event: ResetEvent,
      triggerMode: 'rule-only' | 'rule+ai',
    ): Promise<void>
  }
}

export interface MonitoringResult {
  post: Post
  ruleResult: RuleResult
  analysisResult: PipelineResult
  event: ResetEvent | null
  notifications: Notification[]
}

export class MonitoringPipeline {
  constructor(readonly options: MonitoringPipelineOptions) {}

  async process(post: Post, signal: AbortSignal): Promise<MonitoringResult> {
    await this.options.posts.put(post)
    const ruleResult = this.options.evaluate(post)
    const analysisResult = await this.options.analyze.run(
      {
        ruleResult,
        request: {
          postId: post.postId,
          postUrl: post.url,
          text: post.text,
          parentText: null,
          quotedText: null,
          ruleVersion: ruleResult.ruleVersion,
          matchedRuleIds: ruleResult.matchedRuleIds,
        },
      },
      signal,
    )
    if (!analysisResult.analysis) {
      if (ruleResult.candidate) {
        const event = candidateEvent(post, ruleResult)
        const persisted = await this.options.events.put(event)
        const duplicate =
          persisted &&
          typeof persisted === 'object' &&
          'created' in persisted &&
          persisted.created === false
        const notifications = duplicate
          ? []
          : await this.options.notifications.dispatch({
              schemaVersion: 1,
              eventType: 'rule_candidate',
              eventId: event.eventId,
              semanticVersion: ruleResult.ruleVersion,
              title: event.titleZh,
              summaryZh: `规则命中：${ruleResult.reasons.join('；')}`,
              expectedWindow: '规则未能确定',
              uncertainties: ['AI 未配置、不可用或未完成确认'],
              sourceUrl: post.url,
              isTest: false,
            })
        await Promise.all(
          notifications.map((record) =>
            this.options.notificationRecords.put(record),
          ),
        )
        await this.options.eventAutomation?.onEvent(event, 'rule-only')
        return { post, ruleResult, analysisResult, event, notifications }
      }
      return {
        post,
        ruleResult,
        analysisResult,
        event: null,
        notifications: [],
      }
    }
    const analysis = analysisResult.analysis
    await this.options.analyses.put(analysis)
    const event = eventFromAnalysis(post, analysis)
    if (!event) {
      return {
        post,
        ruleResult,
        analysisResult,
        event: null,
        notifications: [],
      }
    }
    const persistedEvent = await this.options.events.put(event)
    if (
      persistedEvent &&
      typeof persistedEvent === 'object' &&
      'created' in persistedEvent &&
      persistedEvent.created === false
    ) {
      return { post, ruleResult, analysisResult, event, notifications: [] }
    }
    const notificationMessage: NotificationMessage = {
      schemaVersion: 1,
      eventType:
        analysis.eventType === 'completed' ? 'reset_observed' : 'ai_confirmed',
      eventId: event.eventId,
      semanticVersion: analysis.analysisVersion,
      title: event.titleZh,
      summaryZh: analysis.summaryZh,
      expectedWindow: formatWindow(analysis),
      uncertainties: analysis.uncertainties,
      sourceUrl: post.url,
      isTest: false,
    }
    const notifications =
      await this.options.notifications.dispatch(notificationMessage)
    await Promise.all(
      notifications.map((record) =>
        this.options.notificationRecords.put(record),
      ),
    )
    await this.options.eventAutomation?.onEvent(event, 'rule+ai')
    return { post, ruleResult, analysisResult, event, notifications }
  }
}

function candidateEvent(post: Post, ruleResult: RuleResult): ResetEvent {
  const eventId = `${post.postId}--${ruleResult.ruleVersion}--rule-candidate`
  const createdAt = new Date().toISOString()
  return {
    schemaVersion: 1,
    createdAt,
    source: 'rules-baseline',
    contentHash: createHash('sha256')
      .update(`${eventId}:${ruleResult.inputHash}`, 'utf8')
      .digest('hex'),
    eventId,
    postId: post.postId,
    analysisVersion: ruleResult.ruleVersion,
    status: 'candidate',
    eventType: 'vague_intent',
    resetKind: classifyResetKind(post.text),
    scope: '规则候选，范围待确认',
    expectedStart: null,
    expectedEnd: null,
    confirmedAt: null,
    titleZh: '发现可能的重置信号',
  }
}

function eventFromAnalysis(post: Post, analysis: Analysis): ResetEvent | null {
  if (analysis.relevance !== 'relevant' || analysis.eventType === 'non_event')
    return null
  const status = analysis.eventType === 'completed' ? 'confirmed' : 'expected'
  const eventId = `${post.postId}--${analysis.analysisVersion}`
  const createdAt = new Date().toISOString()
  return {
    schemaVersion: 1,
    createdAt,
    source: 'monitoring-pipeline',
    contentHash: createHash('sha256')
      .update(`${eventId}:${status}:${analysis.responseHash}`, 'utf8')
      .digest('hex'),
    eventId,
    postId: post.postId,
    analysisVersion: analysis.analysisVersion,
    status,
    eventType: analysis.eventType,
    resetKind: classifyResetKind(post.text),
    scope: analysis.scope,
    expectedStart: analysis.expectedWindow.start,
    expectedEnd: analysis.expectedWindow.end,
    confirmedAt: status === 'confirmed' ? createdAt : null,
    titleZh: analysis.summaryZh,
  }
}

function formatWindow(analysis: Analysis): string {
  return (
    (analysis.expectedWindow.original ??
      [analysis.expectedWindow.start, analysis.expectedWindow.end]
        .filter(Boolean)
        .join(' — ')) ||
    '未明确'
  )
}

function classifyResetKind(text: string): ResetEvent['resetKind'] {
  if (/\bbanked?\s+reset|reset\s+(?:into\s+)?(?:the\s+)?bank\b/i.test(text))
    return 'banked'
  if (/\bcompensat(?:e|ion|ory)\b/i.test(text)) return 'compensation'
  return 'forced'
}
