import { createHash } from 'node:crypto'
import type { DashboardModel } from '../domain/dashboard.js'
import type {
  Analysis,
  Notification,
  Post,
  ResetEvent,
  RuntimeState,
} from '../domain/models.js'
import {
  isAnalysis,
  isNotification,
  isPost,
  isResetEvent,
  isRuntimeState,
  recordKeys,
} from '../domain/schemas.js'
import { MonitoringPipeline } from '../domain/monitoring-pipeline.js'
import {
  AnalysisPipeline,
  type AnalysisCache,
} from '../adapters/ai/pipeline.js'
import { DeepSeekProvider } from '../adapters/ai/deepseek.js'
import { WindowsCredentialManager } from '../adapters/credentials/windows-credential-manager.js'
import { NotificationDispatcher } from '../adapters/notifications/dispatcher.js'
import { WindowsNotificationChannel } from '../adapters/notifications/windows.js'
import { FxTwitterAdapter } from '../adapters/sources/fx-twitter.js'
import type { RequestLogEntry } from '../adapters/sources/request-log.js'
import { PollScheduler } from '../adapters/sources/scheduler.js'
import type { SourcePost } from '../adapters/sources/types.js'
import { JsonRecordStore, contentHash } from '../adapters/storage/file-store.js'
import { evaluateRulesV1 } from '../rules/rules-v1.js'

const credentialService = 'deepseek'
const credentialAccount = 'api-key'

export class RuntimeController {
  readonly #posts: JsonRecordStore<Post>
  readonly #analyses: JsonRecordStore<Analysis>
  readonly #events: JsonRecordStore<ResetEvent>
  readonly #notifications: JsonRecordStore<Notification>
  readonly #runtime: JsonRecordStore<RuntimeState>
  readonly #credentials = new WindowsCredentialManager()
  readonly #provider: DeepSeekProvider
  readonly #pipeline: MonitoringPipeline
  readonly #scheduler: PollScheduler
  readonly #requestLogs: RequestLogEntry[] = []
  #enabled = false

  constructor(
    dataRoot: string,
    showNotification: (title: string, body: string) => Promise<void>,
  ) {
    this.#posts = store(dataRoot, 'posts', recordKeys.post, isPost)
    this.#analyses = store(
      dataRoot,
      'analyses',
      recordKeys.analysis,
      isAnalysis,
    )
    this.#events = store(dataRoot, 'events', recordKeys.event, isResetEvent)
    this.#notifications = store(
      dataRoot,
      'notifications',
      recordKeys.notification,
      isNotification,
    )
    this.#runtime = store(
      dataRoot,
      'runtime',
      recordKeys.runtime,
      isRuntimeState,
    )
    this.#provider = new DeepSeekProvider({
      apiKey: async () => {
        const key = await this.#credentials.get(
          credentialService,
          credentialAccount,
        )
        if (!key) throw new Error('DeepSeek API Key 未配置')
        return key
      },
    })
    const cache: AnalysisCache = {
      get: async (key) => {
        try {
          return await this.#analyses.get(key)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        }
      },
      put: async (_key, value) => void (await this.#analyses.put(value)),
    }
    this.#pipeline = new MonitoringPipeline({
      analyze: new AnalysisPipeline(this.#provider, cache),
      notifications: new NotificationDispatcher({
        channels: [
          new WindowsNotificationChannel(async ({ title, body }) =>
            showNotification(title, body),
          ),
        ],
      }),
      evaluate: (post) =>
        evaluateRulesV1({
          postId: post.postId,
          excerpt: post.text,
          contentHash: post.contentHash,
        }),
      posts: this.#posts,
      analyses: this.#analyses,
      events: this.#events,
      notificationRecords: this.#notifications,
    })
    const adapter = new FxTwitterAdapter({
      requestLog: async (line) => {
        const entry = JSON.parse(line) as RequestLogEntry
        this.#requestLogs.unshift(entry)
        this.#requestLogs.splice(100)
      },
    })
    this.#scheduler = new PollScheduler({
      adapter,
      onPosts: async (posts) => this.#processPosts(posts),
    })
  }

  async restore(): Promise<void> {
    try {
      const state = await this.#runtime.get('runtime')
      if (state.sourceStatus !== 'disabled') await this.setSourceEnabled(true)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async setSourceEnabled(enabled: boolean): Promise<void> {
    this.#enabled = enabled
    if (enabled) this.#scheduler.start()
    else this.#scheduler.stop()
    await this.#saveRuntimeState()
  }

  async refresh(): Promise<void> {
    if (!this.#enabled) throw new Error('数据源尚未启用')
    await this.#scheduler.pollNow()
    await this.#saveRuntimeState()
  }

  async setDeepSeekKey(secret: string): Promise<void> {
    const key = secret.trim()
    if (key.length < 16) throw new Error('DeepSeek API Key 格式无效')
    await this.#credentials.set(credentialService, credentialAccount, key)
  }

  async deepSeekHint(): Promise<string | null> {
    return this.#credentials.hint(credentialService, credentialAccount)
  }

  async testDeepSeek(): Promise<{ ok: boolean; message: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      return await this.#provider.testConnection(controller.signal)
    } finally {
      clearTimeout(timeout)
    }
  }

  async snapshot(): Promise<DashboardModel> {
    const [posts, analyses, events, notifications] = await Promise.all([
      this.#posts.list(),
      this.#analyses.list(),
      this.#events.list(),
      this.#notifications.list(),
    ])
    const scheduler = this.#scheduler.snapshot()
    const analysesByPost = new Map(analyses.map((item) => [item.postId, item]))
    const eventsByPost = new Map(events.map((item) => [item.postId, item]))
    const latestAnalysis = [...analyses].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0]
    const postUrls = new Map(posts.map((post) => [post.postId, post.url]))
    return {
      health: this.#enabled ? scheduler.sourceStatus : 'disabled',
      lastCheckedAt: scheduler.lastCheckedAt,
      consecutiveFailures: scheduler.consecutiveFailures,
      pollingIntervalMinutes: Math.round(scheduler.nextDelayMs / 60_000),
      stale: this.#enabled ? scheduler.stale : true,
      prediction24h: prediction(events, 24),
      prediction48h: prediction(events, 48),
      latestSummary: latestAnalysis?.summaryZh ?? null,
      latestSourceUrl: latestAnalysis?.sourceUrl ?? null,
      latestEvidence: latestAnalysis?.evidence ?? [],
      posts: [...posts]
        .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
        .slice(0, 50)
        .map((post) => ({
          id: post.postId,
          excerpt: post.text.slice(0, 180),
          capturedAt: post.createdAt,
          ruleMatched: evaluatePost(post),
          aiCalled: analysesByPost.has(post.postId),
          formedEvent: eventsByPost.has(post.postId),
        })),
      events: events.map((event) => ({
        id: event.eventId,
        title: event.titleZh,
        type: event.resetKind,
        status:
          event.status === 'confirmed'
            ? 'confirmed'
            : event.status === 'expected'
              ? 'expected'
              : 'candidate',
        occurredAt: event.confirmedAt ?? event.createdAt,
        sourceUrl: postUrls.get(event.postId) ?? '',
      })),
      requestLogs: this.#requestLogs.map((log) => ({
        timestamp: log.timestamp,
        target: log.targetCategory,
        status: String(log.status),
        durationMs: log.durationMs,
      })),
      details: {
        post: posts.map((post) => detail(post.postId, post.text, post)),
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
      },
    }
  }

  stop(): void {
    this.#scheduler.stop()
  }

  async #processPosts(sourcePosts: SourcePost[]): Promise<void> {
    for (const source of sourcePosts) {
      const post: Post = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        source: 'fxtwitter',
        contentHash: createHash('sha256').update(source.text).digest('hex'),
        postId: source.id,
        url: source.url,
        author: source.author,
        text: source.text,
        postedAt: source.createdAt,
        kind: source.kind,
        parentPostId: source.parentPostId,
        quotedPostId: source.quotedPostId,
      }
      await this.#pipeline.process(post, new AbortController().signal)
    }
  }

  async #saveRuntimeState(): Promise<void> {
    const state = this.#scheduler.snapshot()
    const facts = {
      stateId: 'runtime' as const,
      lastCheckedAt: state.lastCheckedAt,
      sourceStatus: this.#enabled ? state.sourceStatus : ('disabled' as const),
      consecutiveFailures: state.consecutiveFailures,
      pollingIntervalMs: state.nextDelayMs,
      activeSignalUntil: null,
      lastPostId: null,
    }
    await this.#runtime.put({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      source: 'runtime-controller',
      contentHash: contentHash(facts),
      ...facts,
    })
  }
}

function store<
  T extends Post | Analysis | ResetEvent | Notification | RuntimeState,
>(
  rootDirectory: string,
  collection: string,
  idOf: (record: T) => string,
  validate: (record: unknown) => record is T,
) {
  return new JsonRecordStore({ rootDirectory, collection, idOf, validate })
}

function prediction(events: ResetEvent[], hours: number): string | null {
  const limit = Date.now() + hours * 60 * 60_000
  const upcoming = events.find(
    (event) =>
      event.status === 'expected' &&
      event.expectedStart &&
      Date.parse(event.expectedStart) <= limit,
  )
  return upcoming ? upcoming.titleZh : null
}

function evaluatePost(post: Post): boolean {
  return evaluateRulesV1({
    postId: post.postId,
    excerpt: post.text,
    contentHash: post.contentHash,
  }).candidate
}

function detail(
  id: string,
  title: string,
  payload: Post | Analysis | ResetEvent | Notification,
  version = `schema-${payload.schemaVersion}`,
  sourceUrl?: string,
) {
  return {
    id,
    title,
    timestamp: payload.createdAt,
    version,
    sourceUrl,
    payload: { ...payload },
  }
}
