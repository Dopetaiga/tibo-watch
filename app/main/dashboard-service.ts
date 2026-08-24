import type { RequestLogEntry } from '../adapters/sources/request-log.js'
import type { SchedulerState } from '../adapters/sources/scheduler.js'
import type { JsonRecordStore } from '../adapters/storage/file-store.js'
import { resetOverview, type DashboardModel } from '../domain/dashboard.js'
import { computeSavings } from '../domain/savings.js'
import type { CodexUsageSnapshot } from '../adapters/codex/app-server.js'
import {
  buildResetChains,
  deduplicateEventsByPost,
  evaluatePost,
  latestAnalysesByPost,
  prediction,
  selectLatestExpectedEvent,
} from '../domain/event-selection.js'
import { summarizeResetCredits } from '../domain/reset-credits.js'
import type {
  Analysis,
  CodexRateLimitObservation,
  CodexResumeAudit,
  Notification,
  Post,
  ResetEvent,
} from '../domain/models.js'

export interface DashboardServiceStores {
  posts: JsonRecordStore<Post>
  analyses: JsonRecordStore<Analysis>
  events: JsonRecordStore<ResetEvent>
  notifications: JsonRecordStore<Notification>
  codexResumes: JsonRecordStore<CodexResumeAudit>
  codexRateLimits: JsonRecordStore<CodexRateLimitObservation>
}

export interface DashboardServiceLiveState {
  aiConfigured: boolean
  enabled: boolean
  startupComplete: boolean
  backgroundActivity: string | null
  startupWarning: string | null
  lastAiReviewSummary: string | null
  processingWarning: string | null
}

export interface DashboardServiceOptions {
  readState(): DashboardServiceLiveState
  schedulerState(): SchedulerState
  requestLogs: RequestLogEntry[]
  codexUsage(): CodexUsageSnapshot | null
}

/**
 * Assembles domain-scoped dashboard models from the fact stores.
 * Owns presentation-only aggregation; it never writes records.
 */
export class DashboardService {
  readonly #stores: DashboardServiceStores
  readonly #options: DashboardServiceOptions

  constructor(
    stores: DashboardServiceStores,
    options: DashboardServiceOptions,
  ) {
    this.#stores = stores
    this.#options = options
  }

  async snapshot(): Promise<DashboardModel> {
    const [posts, analyses, events, notifications, resumes, rateLimits] =
      await Promise.all([
        this.#stores.posts.list(),
        this.#stores.analyses.list(),
        this.#stores.events.list(),
        this.#stores.notifications.list(),
        this.#stores.codexResumes.list(),
        this.#stores.codexRateLimits.list(),
      ])
    const state = this.#options.readState()
    const scheduler = this.#options.schedulerState()
    const health = this.#dashboardHealth(scheduler.sourceStatus)
    const analysesByPost = latestAnalysesByPost(analyses)
    const eventsByPost = new Map(events.map((item) => [item.postId, item]))
    const latestAnalysis = [...analyses].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0]
    const postUrls = new Map(posts.map((post) => [post.postId, post.url]))
    const effectiveEvents = deduplicateEventsByPost(events)
    const dashboardEvents = effectiveEvents.map((event) => ({
      id: event.eventId,
      title: event.titleZh,
      type: event.resetKind,
      status:
        event.status === 'confirmed'
          ? ('confirmed' as const)
          : event.status === 'expected'
            ? ('expected' as const)
            : ('candidate' as const),
      occurredAt:
        event.confirmedAt ??
        (event.status === 'expected' ? event.expectedStart : null) ??
        '',
      sourceUrl: postUrls.get(event.postId) ?? '',
    }))
    const overview = resetOverview(dashboardEvents)
    const signalCandidate = selectLatestExpectedEvent(
      effectiveEvents,
      posts,
      Date.now(),
    )
    const signalBoundary = signalCandidate
      ? (signalCandidate.expectedEnd ?? signalCandidate.expectedStart)
      : null
    const signal =
      signalCandidate &&
      (!signalBoundary || Date.parse(signalBoundary) > Date.now())
        ? signalCandidate
        : undefined
    const signalAnalysis = signal
      ? analysesByPost.get(signal.postId)
      : undefined
    const signalPost = signal
      ? posts.find((post) => post.postId === signal.postId)
      : undefined
    const resetCredits = summarizeResetCredits(rateLimits, [
      {
        start: overview.baselinePreviousResetAt,
        end: overview.baselinePreviousResetAt,
      },
      {
        start: overview.baselineNextResetAt,
        end: overview.baselineNextResetAt,
      },
      {
        start: signal?.expectedStart ?? null,
        end: signal?.expectedEnd ?? null,
      },
    ])
    return {
      monitorMode: state.aiConfigured ? 'ai-enhanced' : 'rule-only',
      serviceStatus: !state.startupComplete ? 'starting' : 'running',
      savings: computeSavings(
        this.#options.codexUsage()?.dailyUsageBuckets ?? [],
      ),
      codexRuns: (() => {
        const cutoff = new Date(Date.now() - 28 * 86_400_000).toISOString()
        const counts = { completed28d: 0, failed28d: 0, blocked28d: 0 }
        for (const resume of resumes) {
          if ((resume.finishedAt ?? resume.startedAt) < cutoff) continue
          if (resume.status === 'completed') counts.completed28d += 1
          else if (resume.status === 'failed') counts.failed28d += 1
          else if (resume.status === 'blocked') counts.blocked28d += 1
        }
        return counts
      })(),
      dataStatus: !state.enabled
        ? 'disabled'
        : state.backgroundActivity
          ? 'updating'
          : scheduler.sourceStatus === 'offline' ||
              scheduler.sourceStatus === 'degraded'
            ? 'error'
            : scheduler.stale
              ? 'stale'
              : 'current',
      health,
      healthMessage: this.#healthMessage(state, health),
      lastCheckedAt: scheduler.lastCheckedAt,
      consecutiveFailures: scheduler.consecutiveFailures,
      pollingIntervalMinutes: Math.round(scheduler.nextDelayMs / 60_000),
      stale: state.enabled ? scheduler.stale : true,
      ...overview,
      signalPrediction: signal
        ? {
            start: signal.expectedStart,
            end: signal.expectedEnd,
            title: signal.titleZh,
            sourceText:
              signalPost?.text ??
              signalAnalysis?.evidence.join('；') ??
              signal.titleZh,
            sourcePostedAt: signalPost?.postedAt ?? null,
            sourceUrl: signalPost?.url ?? postUrls.get(signal.postId) ?? null,
          }
        : null,
      prediction24h: prediction(effectiveEvents, posts, 24),
      prediction48h: prediction(effectiveEvents, posts, 48),
      latestSummary: latestAnalysis?.summaryZh ?? null,
      latestSourceUrl: latestAnalysis?.sourceUrl ?? null,
      latestEvidence: latestAnalysis?.evidence ?? [],
      resetCredits,
      posts: [...posts]
        .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
        .slice(0, 50)
        .map((post) => ({
          id: post.postId,
          sourceUrl: post.url,
          kind: post.kind,
          excerpt: post.text.slice(0, 180),
          postedAt: post.postedAt,
          ruleMatched: evaluatePost(post),
          aiCalled: analysesByPost.has(post.postId),
          formedEvent: eventsByPost.has(post.postId),
          relevance:
            analysesByPost.get(post.postId)?.relevance ??
            (evaluatePost(post) ? 'candidate' : 'irrelevant'),
          eventType: analysesByPost.get(post.postId)?.eventType ?? null,
        })),
      events: dashboardEvents,
      resetChains: buildResetChains(effectiveEvents, posts),
      requestLogs: this.#options.requestLogs.map((log) => ({
        timestamp: log.timestamp,
        target: log.targetCategory,
        status: String(log.status),
        durationMs: log.durationMs,
      })),
      details: {
        post: posts.map((post) =>
          detail(
            post.postId,
            post.text,
            post,
            `schema-${post.schemaVersion}`,
            post.url,
            post.postedAt,
          ),
        ),
        analysis: analyses.map((analysis) =>
          detail(
            `${analysis.postId}--${analysis.analysisVersion}`,
            analysis.summaryZh,
            analysis,
            analysis.analysisVersion,
            analysis.sourceUrl,
          ),
        ),
        event: events.map((event) =>
          detail(
            event.eventId,
            event.titleZh,
            event,
            event.analysisVersion,
            postUrls.get(event.postId),
          ),
        ),
        notification: notifications.map((notification) =>
          detail(
            notification.notificationId,
            `${notification.channel} · ${notification.status}`,
            notification,
            notification.semanticVersion,
          ),
        ),
        resume: resumes.map((resume) =>
          detail(
            resume.resumeId,
            `${resume.status} · ${resume.threadId}`,
            resume,
            'codex-resume-v1',
          ),
        ),
      },
    }
  }

  #dashboardHealth(
    sourceStatus: 'disabled' | 'healthy' | 'degraded' | 'offline',
  ): DashboardModel['health'] {
    const state = this.#options.readState()
    if (!state.startupComplete) return 'starting'
    if (!state.enabled || sourceStatus === 'disabled') return 'disabled'
    if (sourceStatus === 'offline') return 'offline'
    if (sourceStatus === 'degraded') return 'degraded'
    return 'healthy'
  }

  #healthMessage(
    state: DashboardServiceLiveState,
    health: DashboardModel['health'],
  ): string {
    if (health === 'starting') return '正在恢复配置与初始化监控'
    if (health === 'disabled') return '数据源与监控尚未启用'
    if (health === 'offline') return '数据源异常，仅历史记录可用'
    if (state.backgroundActivity) return state.backgroundActivity
    if (state.startupWarning) return state.startupWarning
    if (state.processingWarning) return state.processingWarning
    if (state.lastAiReviewSummary) return state.lastAiReviewSummary
    if (!state.aiConfigured) return 'AI 未配置，当前使用规则模式'
    if (health === 'degraded') return '数据源不稳定，监控已降级运行'
    return '规则、AI 与数据源均已就绪'
  }
}

function detail(
  id: string,
  title: string,
  payload: Post | Analysis | ResetEvent | Notification | CodexResumeAudit,
  version = `schema-${payload.schemaVersion}`,
  sourceUrl?: string,
  timestamp = payload.createdAt,
) {
  return {
    id,
    title,
    timestamp,
    version,
    sourceUrl,
    payload: { ...payload },
  }
}
