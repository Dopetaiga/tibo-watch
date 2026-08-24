import { createHash } from 'node:crypto'
import type {
  AnalysisPipeline,
  PipelineResult,
} from '../adapters/ai/pipeline.js'
import type { NotificationDispatcher } from '../adapters/notifications/dispatcher.js'
import type { NotificationMessage } from '../adapters/notifications/types.js'
import { isExplicitCompletedReset, type RuleResult } from '../rules/rules-v1.js'
import type { Analysis, Notification, Post, ResetEvent } from './models.js'

export interface FactSink<T> {
  put(record: T): Promise<unknown>
}

export interface MonitoringPipelineOptions {
  analyze: Pick<AnalysisPipeline, 'run'>
  notifications: Pick<NotificationDispatcher, 'dispatch'>
  resolveContext?(post: Post): Promise<{
    parentText: string | null
    quotedText: string | null
  }>
  evaluate(
    post: Post,
    context: { parentText: string | null; quotedText: string | null },
  ): RuleResult
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

  async process(
    post: Post,
    signal: AbortSignal,
    options: { manualAiReview?: boolean } = {},
  ): Promise<MonitoringResult> {
    await this.options.posts.put(post)
    const context = (await this.options.resolveContext?.(post)) ?? {
      parentText: null,
      quotedText: null,
    }
    const ruleResult = this.options.evaluate(post, context)
    const analysisResult = await this.options.analyze.run(
      {
        ruleResult,
        manual: options.manualAiReview,
        manualConfirmed: options.manualAiReview,
        request: {
          postId: post.postId,
          postUrl: post.url,
          postedAt: post.postedAt,
          text: post.text,
          parentText: context.parentText,
          quotedText: context.quotedText,
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
              eventType: completedRuleEvent(event)
                ? 'reset_observed'
                : 'rule_candidate',
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
        if (completedRuleEvent(event))
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
        event.status === 'confirmed'
          ? 'reset_observed'
          : event.status === 'expected'
            ? 'ai_confirmed'
            : 'rule_candidate',
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
    if (event.status === 'confirmed' || event.status === 'expected')
      await this.options.eventAutomation?.onEvent(event, 'rule+ai')
    return { post, ruleResult, analysisResult, event, notifications }
  }
}

function candidateEvent(post: Post, ruleResult: RuleResult): ResetEvent {
  const completed = isExplicitCompletedReset(post.text)
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
    status: completed ? 'confirmed' : 'candidate',
    eventType: completed ? 'completed' : 'vague_intent',
    resetKind: classifyResetKind(post.text),
    scope: '规则候选，范围待确认',
    expectedStart: null,
    expectedEnd: null,
    confirmedAt: completed ? post.postedAt : null,
    titleZh: completed ? '已观察到额度重置' : '发现可能的重置信号',
  }
}

function eventFromAnalysis(post: Post, analysis: Analysis): ResetEvent | null {
  if (analysis.relevance !== 'relevant' || analysis.eventType === 'non_event')
    return null
  const completedByRule = isExplicitCompletedReset(post.text)
  const status =
    analysis.eventType === 'completed' || completedByRule
      ? 'confirmed'
      : analysis.eventType === 'explicit_future'
        ? 'expected'
        : 'candidate'
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
    eventType: completedByRule ? 'completed' : analysis.eventType,
    resetKind: classifyResetKind(post.text),
    scope: analysis.scope,
    expectedStart: analysis.expectedWindow.start,
    expectedEnd: analysis.expectedWindow.end,
    confirmedAt: status === 'confirmed' ? post.postedAt : null,
    titleZh: analysis.summaryZh,
  }
}

function completedRuleEvent(event: ResetEvent): boolean {
  return event.status === 'confirmed' && event.eventType === 'completed'
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
