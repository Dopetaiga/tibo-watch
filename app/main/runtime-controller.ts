import { createHash } from 'node:crypto'
import { resetOverview, type DashboardModel } from '../domain/dashboard.js'
import type {
  Analysis,
  Notification,
  Post,
  ResetEvent,
  RuntimeState,
  CodexResumeAudit,
} from '../domain/models.js'
import {
  isAnalysis,
  isNotification,
  isPost,
  isResetEvent,
  isRuntimeState,
  isCodexResumeAudit,
  recordKeys,
} from '../domain/schemas.js'
import { MonitoringPipeline } from '../domain/monitoring-pipeline.js'
import {
  AnalysisPipeline,
  type AnalysisCache,
} from '../adapters/ai/pipeline.js'
import { DeepSeekProvider } from '../adapters/ai/deepseek.js'
import {
  MultiProtocolProvider,
  type AiProviderConfig,
} from '../adapters/ai/multi-protocol.js'
import type { AnalysisProvider } from '../adapters/ai/types.js'
import { WindowsCredentialManager } from '../adapters/credentials/windows-credential-manager.js'
import { NotificationDispatcher } from '../adapters/notifications/dispatcher.js'
import { WindowsNotificationChannel } from '../adapters/notifications/windows.js'
import { WebhookNotificationChannel } from '../adapters/notifications/webhook.js'
import type {
  NotificationChannel,
  NotificationMessage,
  AutomationEventType,
} from '../adapters/notifications/types.js'
import { FxTwitterAdapter } from '../adapters/sources/fx-twitter.js'
import type { RequestLogEntry } from '../adapters/sources/request-log.js'
import { PollScheduler } from '../adapters/sources/scheduler.js'
import type { SourcePost } from '../adapters/sources/types.js'
import { JsonRecordStore, contentHash } from '../adapters/storage/file-store.js'
import { evaluateRulesV1 } from '../rules/rules-v1.js'
import { runBasicSelfTest, type SelfTestResult } from '../domain/self-test.js'
import {
  CodexAppServerClient,
  type CodexThreadSummary,
} from '../adapters/codex/app-server.js'
import {
  mayStartNewResume,
  nextBudgetGate,
  validateBudgetPolicy,
  type BudgetGateState,
  type CodexBudgetPolicy,
} from '../domain/codex-budget.js'

const credentialService = 'deepseek'
const credentialAccount = 'api-key'
type NotificationPolicy = Record<
  AutomationEventType,
  Array<'windows' | 'feishu' | 'http'>
>

export class RuntimeController {
  readonly #posts: JsonRecordStore<Post>
  readonly #analyses: JsonRecordStore<Analysis>
  readonly #events: JsonRecordStore<ResetEvent>
  readonly #notifications: JsonRecordStore<Notification>
  readonly #runtime: JsonRecordStore<RuntimeState>
  readonly #codexResumes: JsonRecordStore<CodexResumeAudit>
  readonly #credentials = new WindowsCredentialManager()
  #provider: AnalysisProvider
  #pipeline: MonitoringPipeline
  readonly #analysisCache: AnalysisCache
  readonly #scheduler: PollScheduler
  readonly #requestLogs: RequestLogEntry[] = []
  readonly #showNotification: (title: string, body: string) => Promise<void>
  #enabled = false
  #budgetGate: BudgetGateState = 'allow-new-resumes'
  #cleanupTimer: NodeJS.Timeout | null = null

  constructor(
    dataRoot: string,
    showNotification: (title: string, body: string) => Promise<void>,
  ) {
    this.#showNotification = showNotification
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
    this.#codexResumes = store(
      dataRoot,
      'codex-resumes',
      recordKeys.codexResume,
      isCodexResumeAudit,
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
    this.#analysisCache = {
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
    this.#pipeline = this.#createPipeline()
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

  #createPipeline(): MonitoringPipeline {
    return new MonitoringPipeline({
      analyze: new AnalysisPipeline(this.#provider, this.#analysisCache),
      notifications: { dispatch: (message) => this.#dispatch(message) },
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
      eventAutomation: {
        onEvent: (event, triggerMode) =>
          this.#autoResumeForEvent(event, triggerMode),
      },
    })
  }

  async restore(): Promise<void> {
    const serializedProvider = await this.#credentials.get(
      'ai-provider',
      'configuration',
    )
    if (serializedProvider) {
      const config = JSON.parse(serializedProvider) as AiProviderConfig
      this.#provider = new MultiProtocolProvider(config)
      this.#pipeline = this.#createPipeline()
    }
    await this.#pruneIrrelevantCache()
    this.#cleanupTimer = setInterval(
      () => void this.#pruneIrrelevantCache(),
      24 * 60 * 60_000,
    )
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

  async setAiProviderConfig(config: AiProviderConfig): Promise<void> {
    const provider = new MultiProtocolProvider(config)
    await this.#credentials.set(
      'ai-provider',
      'configuration',
      JSON.stringify(config),
    )
    this.#provider = provider
    this.#pipeline = this.#createPipeline()
  }

  async aiProviderSummary(): Promise<{
    configured: boolean
    protocol: AiProviderConfig['protocol'] | null
    baseUrl: string | null
    model: string | null
  }> {
    const serialized = await this.#credentials.get(
      'ai-provider',
      'configuration',
    )
    if (!serialized)
      return { configured: false, protocol: null, baseUrl: null, model: null }
    const config = JSON.parse(serialized) as AiProviderConfig
    return {
      configured: true,
      protocol: config.protocol,
      baseUrl: config.baseUrl,
      model: config.model,
    }
  }

  async testAiProvider(): Promise<{ ok: boolean; message: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      return await this.#provider.testConnection(controller.signal)
    } finally {
      clearTimeout(timeout)
    }
  }

  async codexProbe(): Promise<{
    available: boolean
    authenticated: boolean
    accountType: string | null
    rateLimit: Awaited<ReturnType<CodexAppServerClient['rateLimits']>> | null
    message: string
  }> {
    let client: CodexAppServerClient | null = null
    try {
      client = await CodexAppServerClient.connect()
      const account = await client.account()
      const rateLimit = account.authenticated ? await client.rateLimits() : null
      return {
        available: true,
        authenticated: account.authenticated,
        accountType: account.accountType,
        rateLimit,
        message: account.authenticated
          ? 'Codex App Server 与账户额度读取正常'
          : 'Codex App Server 可用；未授权账户额度读取',
      }
    } catch (error) {
      return {
        available: false,
        authenticated: false,
        accountType: null,
        rateLimit: null,
        message: error instanceof Error ? error.message : 'Codex 探测失败',
      }
    } finally {
      client?.close()
    }
  }

  async codexThreads(): Promise<CodexThreadSummary[]> {
    const client = await CodexAppServerClient.connect()
    try {
      return await client.threads()
    } finally {
      client.close()
    }
  }

  async codexResumeSettings(): Promise<{
    enabled: boolean
    authorizedThreadIds: string[]
    lowerUsedPercent: number
    upperUsedPercent: number
  }> {
    const serialized = await this.#credentials.get('codex-resume', 'settings')
    if (!serialized)
      return {
        enabled: false,
        authorizedThreadIds: [],
        lowerUsedPercent: 40,
        upperUsedPercent: 80,
      }
    return JSON.parse(serialized) as Awaited<
      ReturnType<RuntimeController['codexResumeSettings']>
    >
  }

  async setCodexResumeSettings(value: {
    enabled: boolean
    authorizedThreadIds: string[]
    lowerUsedPercent: number
    upperUsedPercent: number
  }): Promise<void> {
    const policy: CodexBudgetPolicy = value
    validateBudgetPolicy(policy)
    if (
      !Array.isArray(value.authorizedThreadIds) ||
      !value.authorizedThreadIds.every((id) =>
        /^[A-Za-z0-9_-]{3,200}$/.test(id),
      )
    )
      throw new Error('Codex 授权线程列表无效')
    await this.#credentials.set(
      'codex-resume',
      'settings',
      JSON.stringify({
        ...value,
        authorizedThreadIds: [...new Set(value.authorizedThreadIds)],
      }),
    )
  }

  async resumeCodexThread(threadId: string): Promise<{ turnId: string }> {
    const settings = await this.codexResumeSettings()
    if (!settings.enabled) throw new Error('Codex 自动恢复总开关尚未启用')
    if (!settings.authorizedThreadIds.includes(threadId))
      throw new Error('该 Codex 线程未获得恢复授权')
    const client = await CodexAppServerClient.connect()
    try {
      const account = await client.account()
      if (account.authenticated) {
        const rate = await client.rateLimits()
        this.#budgetGate = nextBudgetGate(
          settings,
          this.#budgetGate,
          rate.usedPercent,
        )
        if (!mayStartNewResume(this.#budgetGate))
          throw new Error('当前额度达到用户设置的上限，已阻止新的恢复任务')
      }
      return await client.resumeThread(threadId)
    } finally {
      client.close()
    }
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

  runBasicSelfTest(): SelfTestResult {
    return runBasicSelfTest()
  }

  async setWebhook(
    channel: 'feishu' | 'http',
    url: string,
    headers: Record<string, string> = {},
  ): Promise<void> {
    validateWebhook(channel, url, headers)
    await this.#credentials.set(`webhook-${channel}`, 'url', url.trim())
    await this.#credentials.set(
      `webhook-${channel}`,
      'headers',
      JSON.stringify(headers),
    )
  }

  async webhookHint(channel: 'feishu' | 'http'): Promise<string | null> {
    return this.#credentials.hint(`webhook-${channel}`, 'url')
  }

  async testWebhook(channel: 'feishu' | 'http'): Promise<Notification> {
    const configured = await this.#webhookChannel(channel)
    if (!configured) throw new Error(`${channel} webhook 未配置`)
    const [result] = await new NotificationDispatcher({
      channels: [configured],
      maximumAttempts: 1,
    }).dispatch({
      schemaVersion: 1,
      eventType: 'rule_candidate',
      eventId: `configuration-test-${Date.now()}`,
      semanticVersion: 'configuration-test-v1',
      title: 'Tibo Watch 通知测试',
      summaryZh: '这是一条由用户主动发起的测试通知。',
      expectedWindow: '不适用',
      uncertainties: [],
      sourceUrl: 'https://x.com/thsottiaux',
      isTest: true,
    })
    await this.#notifications.put(result)
    return result
  }

  async notificationPolicy(): Promise<NotificationPolicy> {
    const serialized = await this.#credentials.get(
      'notification-policy',
      'settings',
    )
    return serialized
      ? validateNotificationPolicy(JSON.parse(serialized))
      : defaultNotificationPolicy()
  }

  async setNotificationPolicy(value: unknown): Promise<void> {
    const policy = validateNotificationPolicy(value)
    await this.#credentials.set(
      'notification-policy',
      'settings',
      JSON.stringify(policy),
    )
  }

  async snapshot(): Promise<DashboardModel> {
    const [posts, analyses, events, notifications, resumes] = await Promise.all(
      [
        this.#posts.list(),
        this.#analyses.list(),
        this.#events.list(),
        this.#notifications.list(),
        this.#codexResumes.list(),
      ],
    )
    const scheduler = this.#scheduler.snapshot()
    const analysesByPost = new Map(analyses.map((item) => [item.postId, item]))
    const eventsByPost = new Map(events.map((item) => [item.postId, item]))
    const latestAnalysis = [...analyses].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0]
    const postUrls = new Map(posts.map((post) => [post.postId, post.url]))
    const dashboardEvents = events.map((event) => ({
      id: event.eventId,
      title: event.titleZh,
      type: event.resetKind,
      status:
        event.status === 'confirmed'
          ? ('confirmed' as const)
          : event.status === 'expected'
            ? ('expected' as const)
            : ('candidate' as const),
      occurredAt: event.confirmedAt ?? event.createdAt,
      sourceUrl: postUrls.get(event.postId) ?? '',
    }))
    const overview = resetOverview(dashboardEvents)
    const signal = [...events]
      .filter((event) => event.status === 'expected')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    return {
      health: this.#enabled ? scheduler.sourceStatus : 'disabled',
      lastCheckedAt: scheduler.lastCheckedAt,
      consecutiveFailures: scheduler.consecutiveFailures,
      pollingIntervalMinutes: Math.round(scheduler.nextDelayMs / 60_000),
      stale: this.#enabled ? scheduler.stale : true,
      ...overview,
      signalPrediction: signal
        ? {
            start: signal.expectedStart,
            end: signal.expectedEnd,
            title: signal.titleZh,
          }
        : null,
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
          sourceUrl: post.url,
          kind: post.kind,
          excerpt: post.text.slice(0, 180),
          capturedAt: post.createdAt,
          ruleMatched: evaluatePost(post),
          aiCalled: analysesByPost.has(post.postId),
          formedEvent: eventsByPost.has(post.postId),
          relevance:
            analysesByPost.get(post.postId)?.relevance ??
            (evaluatePost(post) ? 'candidate' : 'irrelevant'),
          eventType: analysesByPost.get(post.postId)?.eventType ?? null,
        })),
      events: dashboardEvents,
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

  stop(): void {
    this.#scheduler.stop()
    if (this.#cleanupTimer) clearInterval(this.#cleanupTimer)
    this.#cleanupTimer = null
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

  async #pruneIrrelevantCache(now = Date.now()): Promise<void> {
    const [posts, analyses, events] = await Promise.all([
      this.#posts.list(),
      this.#analyses.list(),
      this.#events.list(),
    ])
    const analysisByPost = new Map(analyses.map((item) => [item.postId, item]))
    const eventPostIds = new Set(events.map((item) => item.postId))
    const expiredPostIds = new Set(
      posts
        .filter((post) => {
          if (eventPostIds.has(post.postId) || evaluatePost(post)) return false
          const analysis = analysisByPost.get(post.postId)
          if (analysis && analysis.relevance !== 'irrelevant') return false
          const retentionDays = post.kind === 'reply' ? 7 : 14
          return now - Date.parse(post.createdAt) > retentionDays * 86_400_000
        })
        .map((post) => post.postId),
    )
    await this.#posts.deleteWhere((post) => expiredPostIds.has(post.postId))
    await this.#analyses.deleteWhere(
      (analysis) =>
        expiredPostIds.has(analysis.postId) &&
        analysis.relevance === 'irrelevant',
    )
  }

  async #dispatch(message: NotificationMessage): Promise<Notification[]> {
    const enabled = new Set(
      (await this.notificationPolicy())[message.eventType],
    )
    const channels: NotificationChannel[] = []
    if (enabled.has('windows'))
      channels.push(
        new WindowsNotificationChannel(async ({ title, body }) =>
          this.#showNotification(title, body),
        ),
      )
    for (const kind of ['feishu', 'http'] as const) {
      if (!enabled.has(kind)) continue
      const configured = await this.#webhookChannel(kind)
      if (configured) channels.push(configured)
    }
    return new NotificationDispatcher({ channels }).dispatch(message)
  }

  async #autoResumeForEvent(
    event: ResetEvent,
    triggerMode: 'rule-only' | 'rule+ai',
  ): Promise<void> {
    const settings = await this.codexResumeSettings()
    if (!settings.enabled || settings.authorizedThreadIds.length === 0) return
    const threadId = settings.authorizedThreadIds[0]
    const resumeId = `${event.eventId}--${threadId}`
    try {
      await this.#codexResumes.get(resumeId)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const startedAt = new Date().toISOString()
    await this.#dispatchResumeNotification(
      event,
      threadId,
      'codex_resume_started',
      '开始恢复已授权的 Codex 任务',
    )
    try {
      const { turnId } = await this.resumeCodexThread(threadId)
      await this.#codexResumes.put(
        resumeAudit({
          resumeId,
          eventId: event.eventId,
          threadId,
          triggerMode,
          status: 'completed',
          startedAt,
          finishedAt: new Date().toISOString(),
          turnId,
          usedPercent: null,
          errorCode: null,
        }),
      )
      await this.#dispatchResumeNotification(
        event,
        threadId,
        'codex_resume_completed',
        `恢复指令已启动（turn ${turnId}）`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.#codexResumes.put(
        resumeAudit({
          resumeId,
          eventId: event.eventId,
          threadId,
          triggerMode,
          status: /上限|正在运行|未获得|总开关/.test(message)
            ? 'blocked'
            : 'failed',
          startedAt,
          finishedAt: new Date().toISOString(),
          turnId: null,
          usedPercent: null,
          errorCode: message.slice(0, 300),
        }),
      )
      await this.#dispatchResumeNotification(
        event,
        threadId,
        'codex_resume_failed',
        message,
      )
    }
  }

  async #dispatchResumeNotification(
    event: ResetEvent,
    threadId: string,
    eventType: Extract<
      AutomationEventType,
      'codex_resume_started' | 'codex_resume_completed' | 'codex_resume_failed'
    >,
    summaryZh: string,
  ): Promise<void> {
    const records = await this.#dispatch({
      schemaVersion: 1,
      eventType,
      eventId: `${event.eventId}--${threadId}`,
      semanticVersion: 'codex-resume-v1',
      title: `Codex 任务：${threadId}`,
      summaryZh,
      expectedWindow: '立即',
      uncertainties: [],
      sourceUrl: 'https://x.com/thsottiaux',
      isTest: false,
    })
    await Promise.all(records.map((record) => this.#notifications.put(record)))
  }

  async #webhookChannel(
    channel: 'feishu' | 'http',
  ): Promise<WebhookNotificationChannel | null> {
    const service = `webhook-${channel}`
    const url = await this.#credentials.get(service, 'url')
    if (!url) return null
    const serializedHeaders = await this.#credentials.get(service, 'headers')
    const headers = serializedHeaders
      ? (JSON.parse(serializedHeaders) as Record<string, string>)
      : {}
    validateWebhook(channel, url, headers)
    return new WebhookNotificationChannel({
      id: channel,
      url: async () => url,
      headers: async () => ({ ...headers }),
    })
  }
}

function store<
  T extends
    | Post
    | Analysis
    | ResetEvent
    | Notification
    | RuntimeState
    | CodexResumeAudit,
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
  payload: Post | Analysis | ResetEvent | Notification | CodexResumeAudit,
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

function resumeAudit(
  facts: Omit<
    CodexResumeAudit,
    'schemaVersion' | 'createdAt' | 'source' | 'contentHash'
  >,
): CodexResumeAudit {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    source: 'codex-resume-controller',
    contentHash: contentHash(facts),
    ...facts,
  }
}

const automationEventTypes: AutomationEventType[] = [
  'rule_candidate',
  'ai_confirmed',
  'reset_observed',
  'codex_resume_started',
  'codex_resume_waiting_approval',
  'codex_resume_completed',
  'codex_resume_failed',
]

function defaultNotificationPolicy(): NotificationPolicy {
  return Object.fromEntries(
    automationEventTypes.map((eventType) => [
      eventType,
      ['windows', 'feishu', 'http'],
    ]),
  ) as NotificationPolicy
}

function validateNotificationPolicy(value: unknown): NotificationPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('通知策略无效')
  const object = value as Record<string, unknown>
  const result = {} as NotificationPolicy
  for (const eventType of automationEventTypes) {
    const channels = object[eventType]
    if (
      !Array.isArray(channels) ||
      !channels.every((channel) =>
        ['windows', 'feishu', 'http'].includes(String(channel)),
      )
    )
      throw new Error(`通知策略无效：${eventType}`)
    result[eventType] = [...new Set(channels)] as Array<
      'windows' | 'feishu' | 'http'
    >
  }
  return result
}

export function validateWebhook(
  channel: 'feishu' | 'http',
  value: string,
  headers: Record<string, string>,
): void {
  const url = new URL(value.trim())
  if (url.protocol !== 'https:') throw new Error('Webhook 必须使用 HTTPS')
  if (
    channel === 'feishu' &&
    !['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname)
  )
    throw new Error('飞书 webhook 主机无效')
  for (const [name, headerValue] of Object.entries(headers)) {
    if (
      !/^[A-Za-z0-9-]{1,64}$/.test(name) ||
      /^(host|content-length)$/i.test(name)
    )
      throw new Error(`不允许的 webhook 请求头：${name}`)
    if (typeof headerValue !== 'string' || headerValue.length > 4096)
      throw new Error(`Webhook 请求头值无效：${name}`)
  }
}
