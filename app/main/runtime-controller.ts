import { createHash } from 'node:crypto'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resetOverview, type DashboardModel } from '../domain/dashboard.js'
import { summarizeResetCredits } from '../domain/reset-credits.js'
import type {
  Analysis,
  Notification,
  Post,
  ResetEvent,
  RuntimeState,
  CodexResumeAudit,
  CodexRateLimitObservation,
} from '../domain/models.js'
import {
  isAnalysis,
  isNotification,
  isPost,
  isResetEvent,
  isRuntimeState,
  isCodexResumeAudit,
  isCodexRateLimitObservation,
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
import type { CredentialStore } from '../adapters/credentials/types.js'
import { NotificationDispatcher } from '../adapters/notifications/dispatcher.js'
import { WindowsNotificationChannel } from '../adapters/notifications/windows.js'
import { WebhookNotificationChannel } from '../adapters/notifications/webhook.js'
import type {
  NotificationChannel,
  NotificationMessage,
  AutomationEventType,
} from '../adapters/notifications/types.js'
import { FxTwitterAdapter } from '../adapters/sources/fx-twitter.js'
import { CustomEndpointAdapter } from '../adapters/sources/custom-endpoint.js'
import type { RequestLogEntry } from '../adapters/sources/request-log.js'
import { PollScheduler } from '../adapters/sources/scheduler.js'
import type { SourcePost } from '../adapters/sources/types.js'
import { JsonRecordStore, contentHash } from '../adapters/storage/file-store.js'
import { evaluateRulesV1 } from '../rules/rules-v1.js'
import { runBasicSelfTest, type SelfTestResult } from '../domain/self-test.js'
import {
  CodexAppServerClient,
  resolveCodexExecutable,
  type CodexThreadSummary,
} from '../adapters/codex/app-server.js'
import {
  mayStartNewResume,
  mayStartAutomation,
  nextBudgetGate,
  validateAutomationSettings,
  validateBudgetPolicy,
  type BudgetGateState,
  type CodexAutomationSettings,
  type CodexBudgetPolicy,
  type CodexThreadAutomationSettings,
} from '../domain/codex-budget.js'

const credentialService = 'deepseek'
const credentialAccount = 'api-key'
type NotificationPolicy = Record<
  AutomationEventType,
  Array<'windows' | 'feishu' | 'http'>
>

export class RuntimeController {
  readonly #dataRoot: string
  readonly #posts: JsonRecordStore<Post>
  readonly #analyses: JsonRecordStore<Analysis>
  readonly #events: JsonRecordStore<ResetEvent>
  readonly #notifications: JsonRecordStore<Notification>
  readonly #runtime: JsonRecordStore<RuntimeState>
  readonly #codexResumes: JsonRecordStore<CodexResumeAudit>
  readonly #codexRateLimits: JsonRecordStore<CodexRateLimitObservation>
  readonly #credentials: CredentialStore
  #provider: AnalysisProvider
  #pipeline: MonitoringPipeline
  readonly #analysisCache: AnalysisCache
  #scheduler: PollScheduler
  readonly #requestLogs: RequestLogEntry[] = []
  readonly #showNotification: (title: string, body: string) => Promise<void>
  #enabled = false
  #startupComplete = false
  #aiConfigured = false
  #startupWarning: string | null = null
  #lastAiReviewSummary: string | null = null
  #backgroundActivity: string | null = null
  #budgetGate: BudgetGateState = 'allow-new-resumes'
  #cleanupTimer: NodeJS.Timeout | null = null
  #codexRateLimitTimer: NodeJS.Timeout | null = null
  readonly #predictionTimers = new Map<string, NodeJS.Timeout>()
  readonly #notificationDispatcher: NotificationDispatcher
  readonly #codexResumeInflight = new Map<string, Promise<void>>()
  #resumeMutex: Promise<unknown> = Promise.resolve()
  #processingWarning: string | null = null

  constructor(
    dataRoot: string,
    showNotification: (title: string, body: string) => Promise<void>,
    credentials: CredentialStore = new WindowsCredentialManager(),
  ) {
    this.#dataRoot = dataRoot
    this.#showNotification = showNotification
    this.#credentials = credentials
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
    this.#codexRateLimits = store(
      dataRoot,
      'codex-rate-limits',
      recordKeys.codexRateLimit,
      isCodexRateLimitObservation,
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
          // A corrupted cache entry must not break monitoring; isolate it and
          // treat it as a cache miss so the analysis can be redone.
          try {
            await this.#analyses.quarantine(key)
          } catch {
            // Quarantine is best-effort.
          }
          return null
        }
      },
      put: async (_key, value) => void (await this.#analyses.put(value)),
    }
    this.#pipeline = this.#createPipeline()
    this.#notificationDispatcher = new NotificationDispatcher({
      channels: (message) =>
        this.#resolveNotificationChannels(message.eventType),
    })
    this.#scheduler = this.#createScheduler()
  }

  #createScheduler(baseUrl?: string): PollScheduler {
    const adapter = this.#createSourceAdapter(baseUrl)
    return new PollScheduler({
      adapter,
      onPosts: async (posts) => this.#processPosts(posts),
    })
  }

  #createSourceAdapter(baseUrl?: string): FxTwitterAdapter {
    const options = {
      requestLog: async (line: string) => {
        const entry = JSON.parse(line) as RequestLogEntry
        this.#requestLogs.unshift(entry)
        this.#requestLogs.splice(100)
      },
    }
    const adapter = baseUrl
      ? new CustomEndpointAdapter({ ...options, baseUrl })
      : new FxTwitterAdapter(options)
    return adapter
  }

  #createPipeline(): MonitoringPipeline {
    return new MonitoringPipeline({
      analyze: this.#analysisRunner(),
      notifications: { dispatch: (message) => this.#dispatch(message) },
      resolveContext: (post) => this.#postContext(post),
      evaluate: (post, context) =>
        evaluateRulesV1({
          postId: post.postId,
          excerpt: post.text,
          contentHash: post.contentHash,
          parentContext: { excerpt: context.parentText },
          quotedContext: { excerpt: context.quotedText },
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

  #analysisRunner(): Pick<AnalysisPipeline, 'run'> {
    if (this.#aiConfigured)
      return new AnalysisPipeline(this.#provider, this.#analysisCache)
    return {
      run: async () => ({
        status: 'skipped_ai_disabled' as const,
        analysis: null,
      }),
    }
  }

  async #postContext(post: Post): Promise<{
    parentText: string | null
    quotedText: string | null
  }> {
    const read = async (postId: string | null): Promise<string | null> => {
      if (!postId) return null
      try {
        return (await this.#posts.get(postId)).text
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    }
    const [parentText, quotedText] = await Promise.all([
      read(post.parentPostId),
      read(post.quotedPostId),
    ])
    return { parentText, quotedText }
  }

  async restore(): Promise<void> {
    const isolatedTestMode = process.env.TIBO_WATCH_E2E_MODE === '1'
    const sourceEndpoint = isolatedTestMode
      ? null
      : await this.#credentials.get('source', 'custom-endpoint')
    if (sourceEndpoint) this.#scheduler = this.#createScheduler(sourceEndpoint)
    const serializedProvider = isolatedTestMode
      ? null
      : await this.#credentials.get('ai-provider', 'configuration')
    if (serializedProvider) {
      this.#aiConfigured = true
      const config = JSON.parse(serializedProvider) as AiProviderConfig
      this.#provider = new MultiProtocolProvider(config)
      this.#pipeline = this.#createPipeline()
    }
    let shouldEnable = true
    try {
      const state = await this.#runtime.get('runtime')
      shouldEnable = state.sourceStatus !== 'disabled'
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    } finally {
      this.#enabled = shouldEnable
      this.#startupComplete = true
    }
    this.#backgroundActivity = shouldEnable ? '正在更新数据源' : null
    void this.#finishBackgroundInitialization(sourceEndpoint)
  }

  async #finishBackgroundInitialization(
    sourceEndpoint: string | null,
  ): Promise<void> {
    // Codex quota is independent from the Tibo history bootstrap. Start it
    // immediately so the dashboard does not wait for backfill or AI review.
    void this.#refreshCodexRateLimit()
    this.#codexRateLimitTimer = setInterval(
      () => void this.#refreshCodexRateLimit(),
      5 * 60_000,
    )
    // Heal stale JSONL indexes once per launch; cheap compared to the I/O that
    // follows, and keeps backup/export artifacts trustworthy.
    await Promise.all(
      [
        this.#posts,
        this.#analyses,
        this.#events,
        this.#notifications,
        this.#runtime,
        this.#codexResumes,
        this.#codexRateLimits,
      ].map((recordStore) =>
        recordStore.ensureIndexIntact().catch(() => {}),
      ),
    )
    if (this.#enabled) {
      try {
        await this.#runInitialHistoryBackfill(sourceEndpoint)
        await this.#seedSchedulerFromStoredPosts()
        await this.#scheduler.pollNow()
      } catch {
        this.#startupWarning = '数据源更新失败，当前使用现有本地历史'
        this.#requestLogs.unshift({
          timestamp: new Date().toISOString(),
          targetCategory: 'history-bootstrap',
          status: 'error',
          durationMs: 0,
          resultCount: 0,
        })
      }
    } else await this.#seedSchedulerFromStoredPosts()
    this.#backgroundActivity = '正在更新监控判断'
    try {
      const result = await this.#initializeMonitorFromRecentHistory()
      if (this.#aiConfigured && result.failed > 0)
        this.#startupWarning = `AI 历史复核完成 ${result.analyzed} 条，失败 ${result.failed} 条：${result.firstError ?? '未知错误'}；预测可能不完整`
      else if (this.#aiConfigured)
        this.#lastAiReviewSummary = `AI 历史复核完成 ${result.analyzed} 条`
    } catch (error) {
      this.#startupWarning = `AI 历史复核失败：${shortError(error)}`
    } finally {
      this.#backgroundActivity = null
      if (this.#enabled) this.#scheduler.start()
    }
    await this.#restorePredictionAutomations()
    await this.#pruneIrrelevantCache()
    this.#cleanupTimer = setInterval(
      () => {
        void this.#pruneIrrelevantCache()
        void this.#pruneCodexRateLimits()
      },
      24 * 60 * 60_000,
    )
  }

  async #restorePredictionAutomations(): Promise<void> {
    const settings = await this.codexResumeSettings()
    if (
      !settings.enabled ||
      !settings.authorizedThreadIds.some(
        (threadId) =>
          (settings.threadSettings[threadId] ?? settings)
            .beforePredictionEnabled,
      )
    )
      return
    const expected = currentExpectedEvents(
      deduplicateEventsByPost(await this.#events.list()),
      await this.#posts.list(),
      Date.now(),
    )
    for (const event of expected)
      this.#schedulePredictionAutomation(event, 'rule+ai', settings)
  }

  async setSourceEnabled(enabled: boolean): Promise<void> {
    this.#enabled = enabled
    if (enabled) {
      await this.#seedSchedulerFromStoredPosts()
      this.#scheduler.start()
    }
    else this.#scheduler.stop()
    await this.#saveRuntimeState()
  }

  async setCustomSourceEndpoint(value: string | null): Promise<void> {
    const endpoint = value?.trim() || null
    const replacement = this.#createScheduler(endpoint ?? undefined)
    this.#scheduler.stop()
    this.#scheduler = replacement
    if (endpoint)
      await this.#credentials.set('source', 'custom-endpoint', endpoint)
    else await this.#credentials.delete('source', 'custom-endpoint')
    if (this.#enabled) {
      await this.#seedSchedulerFromStoredPosts()
      this.#scheduler.start()
    }
  }

  async #seedSchedulerFromStoredPosts(): Promise<void> {
    this.#scheduler.seed(
      (await this.#posts.list()).map((post) => ({
        id: post.postId,
        createdAt: post.postedAt,
      })),
    )
  }

  async sourceConfiguration(): Promise<{
    customEndpoint: string | null
  }> {
    return {
      customEndpoint: await this.#credentials.get('source', 'custom-endpoint'),
    }
  }

  async refresh(): Promise<void> {
    if (!this.#enabled) throw new Error('数据源尚未启用')
    await this.#scheduler.pollNow()
    await this.#saveRuntimeState()
  }

  async historyBackfillStatus(): Promise<{
    complete: boolean
    pagesFetched: number
    postsStored: number
  }> {
    const serialized = await this.#credentials.get('source', 'history-backfill')
    return serialized
      ? (JSON.parse(serialized) as {
          complete: boolean
          pagesFetched: number
          postsStored: number
        })
      : { complete: false, pagesFetched: 0, postsStored: 0 }
  }

  async retryHistoryBackfill(): Promise<{
    complete: boolean
    pagesFetched: number
    postsStored: number
  }> {
    const endpoint = await this.#credentials.get('source', 'custom-endpoint')
    return this.#runInitialHistoryBackfill(endpoint, true)
  }

  async setDeepSeekKey(secret: string): Promise<void> {
    const key = secret.trim()
    if (key.length < 16) throw new Error('DeepSeek API Key 格式无效')
    await this.#credentials.set(credentialService, credentialAccount, key)
  }

  async setAiProviderConfig(config: AiProviderConfig): Promise<void> {
    const provider = new MultiProtocolProvider(config)
    await this.#resetRecentAiWindow()
    await this.#credentials.set(
      'ai-provider',
      'configuration',
      JSON.stringify(config),
    )
    this.#aiConfigured = true
    this.#provider = provider
    this.#pipeline = this.#createPipeline()
    this.#startupWarning = null
    this.#lastAiReviewSummary = null
  }

  async #resetRecentAiWindow(now = Date.now()): Promise<{
    analysesDeleted: number
    eventsDeleted: number
  }> {
    const postIds = new Set(
      selectInitialReviewPosts(await this.#posts.list(), now).map(
        ({ postId }) => postId,
      ),
    )
    const analysesDeleted = await this.#analyses.deleteWhere((analysis) =>
      postIds.has(analysis.postId),
    )
    const eventsDeleted = await this.#events.deleteWhere(
      (event) =>
        postIds.has(event.postId) && event.source === 'monitoring-pipeline',
    )
    return { analysesDeleted, eventsDeleted }
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
      client = await this.#codexClient()
      const account = await client.account()
      const rateLimit = account.authenticated ? await client.rateLimits() : null
      if (rateLimit) await this.#recordCodexRateLimit(rateLimit)
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
    const client = await this.#codexClient()
    try {
      return await client.threads()
    } finally {
      client.close()
    }
  }

  async #refreshCodexRateLimit(): Promise<void> {
    let client: CodexAppServerClient | null = null
    try {
      client = await this.#codexClient()
      const account = await client.account()
      if (!account.authenticated) return
      await this.#recordCodexRateLimit(await client.rateLimits())
    } catch {
      // Codex is optional; monitoring continues with the last local snapshot.
    } finally {
      client?.close()
    }
  }

  async #recordCodexRateLimit(
    rateLimit: Awaited<ReturnType<CodexAppServerClient['rateLimits']>>,
  ): Promise<void> {
    const observedAt = new Date().toISOString()
    const latest = (await this.#codexRateLimits.list()).sort((a, b) =>
      b.observedAt.localeCompare(a.observedAt),
    )[0]
    if (latest) {
      const age = Date.parse(observedAt) - Date.parse(latest.observedAt)
      const usedDelta =
        latest.usedPercent === null || rateLimit.usedPercent === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(latest.usedPercent - rateLimit.usedPercent)
      const creditsChanged =
        latest.availableResetCredits !== rateLimit.availableResetCredits ||
        JSON.stringify(latest.resetCredits) !==
          JSON.stringify(rateLimit.resetCredits)
      if (age < 30 * 60_000 && usedDelta < 5 && !creditsChanged) return
    }
    const facts = {
      observationId: String(Date.now()),
      observedAt,
      ...rateLimit,
    }
    await this.#codexRateLimits.put({
      schemaVersion: 1,
      createdAt: observedAt,
      source: 'codex-app-server',
      contentHash: contentHash(facts),
      ...facts,
    })
  }

  async #pruneCodexRateLimits(now = Date.now()): Promise<number> {
    const cutoff = now - 35 * 86_400_000
    return this.#codexRateLimits.deleteWhere(
      (observation) => Date.parse(observation.observedAt) < cutoff,
    )
  }

  async codexResumeSettings(): Promise<CodexAutomationSettings> {
    const serialized = await this.#credentials.get('codex-resume', 'settings')
    if (!serialized)
      return {
        enabled: false,
        authorizedThreadIds: [],
        lowerUsedPercent: 40,
        upperUsedPercent: 80,
        afterResetEnabled: true,
        beforePredictionEnabled: false,
        beforePredictionHours: 2,
        maximumRunsPerCycle: 1,
        targetSpendPercent: 20,
        minimumRemainingPercent: 20,
        action: 'resume',
        accelerationPrompt:
          '额度即将重置。请继续当前目标，在不扩大权限范围的前提下提高推理强度并优先推进最有价值的未完成工作；不要为了消耗额度制造无意义工作。',
        threadSettings: {},
      }
    const saved = JSON.parse(serialized) as Partial<CodexAutomationSettings>
    return {
      enabled: saved.enabled ?? false,
      authorizedThreadIds: saved.authorizedThreadIds ?? [],
      lowerUsedPercent: saved.lowerUsedPercent ?? 40,
      upperUsedPercent: saved.upperUsedPercent ?? 80,
      afterResetEnabled: saved.afterResetEnabled ?? true,
      beforePredictionEnabled: saved.beforePredictionEnabled ?? false,
      beforePredictionHours: saved.beforePredictionHours ?? 2,
      maximumRunsPerCycle: saved.maximumRunsPerCycle ?? 1,
      targetSpendPercent: saved.targetSpendPercent ?? 20,
      minimumRemainingPercent: saved.minimumRemainingPercent ?? 20,
      action: saved.action ?? 'resume',
      accelerationPrompt:
        saved.accelerationPrompt ??
        '额度即将重置。请继续当前目标，在不扩大权限范围的前提下提高推理强度并优先推进最有价值的未完成工作；不要为了消耗额度制造无意义工作。',
      threadSettings:
        saved.threadSettings ??
        Object.fromEntries(
          (saved.authorizedThreadIds ?? []).map((threadId) => [
            threadId,
            {
              afterResetEnabled: saved.afterResetEnabled ?? true,
              beforePredictionEnabled: saved.beforePredictionEnabled ?? false,
              beforePredictionHours: saved.beforePredictionHours ?? 2,
              targetSpendPercent: saved.targetSpendPercent ?? 20,
              minimumRemainingPercent: saved.minimumRemainingPercent ?? 20,
              action: saved.action ?? 'resume',
              accelerationPrompt:
                saved.accelerationPrompt ??
                '额度即将重置。请继续当前目标，在不扩大权限范围的前提下提高推理强度并优先推进最有价值的未完成工作；不要为了消耗额度制造无意义工作。',
            },
          ]),
        ),
    }
  }

  async setCodexResumeSettings(value: CodexAutomationSettings): Promise<void> {
    const policy: CodexBudgetPolicy = value
    validateBudgetPolicy(policy)
    validateAutomationSettings(value)
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
    this.#clearPredictionTimers()
    await this.#restorePredictionAutomations()
  }

  #clearPredictionTimers(): void {
    for (const timer of this.#predictionTimers.values()) clearTimeout(timer)
    this.#predictionTimers.clear()
  }

  async resumeCodexThread(
    threadId: string,
    instruction?: string,
  ): Promise<{ turnId: string }> {
    const client = await this.#codexClient()
    try {
      const result = await client.resumeThread(threadId, instruction)
      await client.waitForTurnCompletion(threadId, result.turnId)
      return result
    } finally {
      client.close()
    }
  }

  #withResumeLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#resumeMutex.then(operation, operation)
    this.#resumeMutex = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #resumeAuthorizedCodexThread(
    threadId: string,
    instruction: string | undefined,
    settings: CodexAutomationSettings,
  ): Promise<{ turnId: string }> {
    if (!settings.enabled) throw new Error('Codex 自动执行总开关尚未启用')
    if (!settings.authorizedThreadIds.includes(threadId))
      throw new Error('该 Codex 任务未加入自动计划')
    // Serialize quota read → gate → start so concurrent triggers cannot both
    // pass the budget gate against the same pre-spend snapshot.
    return this.#withResumeLock(async () => {
      const client = await this.#codexClient()
      try {
        const account = await client.account()
        if (account.authenticated) {
          const rate = await client.rateLimits()
          await this.#recordCodexRateLimit(rate)
          this.#budgetGate = nextBudgetGate(
            settings,
            this.#budgetGate,
            rate.usedPercent,
          )
          if (!mayStartNewResume(this.#budgetGate))
            throw new Error('当前额度达到用户设置的上限，已阻止新的恢复任务')
          if (!mayStartAutomation(rate.usedPercent, settings))
            throw new Error(
              '当前额度不足以满足单轮目标消耗和保留额度，已阻止启动',
            )
        } else if (settings.action === 'accelerate') {
          throw new Error('无法读取账户额度时，不执行自动加速消耗')
        }
        const result = await client.resumeThread(threadId, instruction)
        await client.waitForTurnCompletion(threadId, result.turnId)
        return result
      } finally {
        client.close()
      }
    })
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

  async storageStatus(): Promise<{
    bytes: number
    records: Record<string, number>
  }> {
    const entries = await Promise.all([
      ['posts', (await this.#posts.list()).length] as const,
      ['analyses', (await this.#analyses.list()).length] as const,
      ['events', (await this.#events.list()).length] as const,
      ['notifications', (await this.#notifications.list()).length] as const,
      ['resumes', (await this.#codexResumes.list()).length] as const,
      ['rateLimits', (await this.#codexRateLimits.list()).length] as const,
    ])
    return {
      bytes: await directorySize(this.#dataRoot),
      records: Object.fromEntries(entries),
    }
  }

  async maintainStorage(): Promise<{
    deleted: number
    indexesRebuilt: number
  }> {
    const deleted =
      (await this.#pruneIrrelevantCache()) +
      (await this.#pruneCodexRateLimits())
    const indexesRebuilt = (
      await Promise.all([
        this.#posts.rebuildIndex(),
        this.#analyses.rebuildIndex(),
        this.#events.rebuildIndex(),
        this.#notifications.rebuildIndex(),
        this.#codexResumes.rebuildIndex(),
        this.#codexRateLimits.rebuildIndex(),
      ])
    ).reduce((sum, count) => sum + count, 0)
    return { deleted, indexesRebuilt }
  }

  async exportData(destination: string): Promise<number> {
    await mkdir(destination, { recursive: true })
    const exports = [
      ['posts', await this.#posts.list()],
      ['analyses', await this.#analyses.list()],
      ['events', await this.#events.list()],
      ['notifications', await this.#notifications.list()],
      ['codex-resumes', await this.#codexResumes.list()],
      ['codex-rate-limits', await this.#codexRateLimits.list()],
    ] as const
    let count = 0
    for (const [name, records] of exports) {
      count += records.length
      await writeFile(
        path.join(destination, `${name}.json`),
        `${JSON.stringify(records, null, 2)}\n`,
        'utf8',
      )
    }
    await writeFile(
      path.join(destination, 'manifest.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          records: count,
          excludes: [
            'API keys',
            'webhook secrets',
            'Codex authorization settings',
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    return count
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
    return result
  }

  async setCodexExecutablePath(value: string): Promise<void> {
    if (!/\.exe$/i.test(value.trim())) throw new Error('请选择 codex.exe')
    await this.#credentials.set('codex-resume', 'executable-path', value.trim())
  }

  async codexExecutableHint(): Promise<string | null> {
    const configured = await this.#credentials.get(
      'codex-resume',
      'executable-path',
    )
    const resolved = await resolveCodexExecutable(configured)
    if (configured && resolved !== configured)
      await this.#credentials.delete('codex-resume', 'executable-path')
    return resolved
  }

  async #codexClient(): Promise<CodexAppServerClient> {
    return CodexAppServerClient.connect(await this.codexExecutableHint())
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
    const [posts, analyses, events, notifications, resumes, rateLimits] =
      await Promise.all([
        this.#posts.list(),
        this.#analyses.list(),
        this.#events.list(),
        this.#notifications.list(),
        this.#codexResumes.list(),
        this.#codexRateLimits.list(),
      ])
    const scheduler = this.#scheduler.snapshot()
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
      monitorMode: this.#aiConfigured ? 'ai-enhanced' : 'rule-only',
      serviceStatus: !this.#startupComplete ? 'starting' : 'running',
      dataStatus: !this.#enabled
        ? 'disabled'
        : this.#backgroundActivity
          ? 'updating'
          : scheduler.sourceStatus === 'offline' ||
              scheduler.sourceStatus === 'degraded'
            ? 'error'
            : scheduler.stale
              ? 'stale'
              : 'current',
      health,
      healthMessage: this.#healthMessage(health),
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
      requestLogs: this.#requestLogs.map((log) => ({
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
    if (!this.#startupComplete) return 'starting'
    if (!this.#enabled || sourceStatus === 'disabled') return 'disabled'
    if (sourceStatus === 'offline') return 'offline'
    if (sourceStatus === 'degraded') return 'degraded'
    return 'healthy'
  }

  #healthMessage(health: DashboardModel['health']): string {
    if (health === 'starting') return '正在恢复配置与初始化监控'
    if (health === 'disabled') return '数据源与监控尚未启用'
    if (health === 'offline') return '数据源异常，仅历史记录可用'
    if (this.#backgroundActivity) return this.#backgroundActivity
    if (this.#startupWarning) return this.#startupWarning
    if (this.#processingWarning) return this.#processingWarning
    if (this.#lastAiReviewSummary) return this.#lastAiReviewSummary
    if (!this.#aiConfigured) return 'AI 未配置，当前使用规则模式'
    if (health === 'degraded') return '数据源不稳定，监控已降级运行'
    return '规则、AI 与数据源均已就绪'
  }

  stop(): void {
    this.#scheduler.stop()
    if (this.#cleanupTimer) clearInterval(this.#cleanupTimer)
    this.#cleanupTimer = null
    if (this.#codexRateLimitTimer) clearInterval(this.#codexRateLimitTimer)
    this.#codexRateLimitTimer = null
    this.#clearPredictionTimers()
  }

  async #processPosts(sourcePosts: SourcePost[]): Promise<void> {
    const posts = sourcePosts.map(
      (source): Post => ({
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
      }),
    )
    await Promise.all(posts.map((post) => this.#posts.put(post)))
    let firstError: string | null = null
    for (const post of posts) {
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(new Error('AI 分析超过 60 秒')),
        60_000,
      )
      try {
        await this.#pipeline.process(post, controller.signal)
        this.#processingWarning = null
      } catch (error) {
        firstError ??= shortError(error)
      } finally {
        clearTimeout(timeout)
      }
    }
    if (firstError) {
      this.#processingWarning = `最新消息处理中断：${firstError}`
    }
  }

  async #initializeMonitorFromRecentHistory(): Promise<{
    analyzed: number
    failed: number
    firstError: string | null
  }> {
    const recentPosts = selectInitialReviewPosts(await this.#posts.list())
    if (recentPosts.length === 0)
      return { analyzed: 0, failed: 0, firstError: null }
    const replayPipeline = new MonitoringPipeline({
      analyze: this.#analysisRunner(),
      notifications: { dispatch: async () => [] },
      resolveContext: (post) => this.#postContext(post),
      evaluate: (post, context) =>
        evaluateRulesV1({
          postId: post.postId,
          excerpt: post.text,
          contentHash: post.contentHash,
          parentContext: { excerpt: context.parentText },
          quotedContext: { excerpt: context.quotedText },
        }),
      posts: this.#posts,
      analyses: this.#analyses,
      events: this.#events,
      notificationRecords: this.#notifications,
    })
    let analyzed = 0
    let failed = 0
    let firstError: string | null = null
    const review = async (post: Post) => {
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(new Error('AI 分析超过 60 秒')),
        60_000,
      )
      try {
        const result = await replayPipeline.process(post, controller.signal, {
          manualAiReview: false,
        })
        if (result.analysisResult.analysis) analyzed += 1
        else if (
          this.#aiConfigured &&
          result.analysisResult.status === 'failed'
        ) {
          failed += 1
          firstError ??= result.analysisResult.errors.at(-1) ?? '未知错误'
        }
      } catch (error) {
        failed += 1
        firstError ??= shortError(error)
      } finally {
        clearTimeout(timeout)
      }
    }
    for (let index = 0; index < recentPosts.length; index += 4)
      await Promise.all(recentPosts.slice(index, index + 4).map(review))
    return { analyzed, failed, firstError }
  }

  async #storeHistoricalPosts(sourcePosts: SourcePost[]): Promise<number> {
    let stored = 0
    for (const source of sourcePosts) {
      const post: Post = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        source: 'fxtwitter-history-bootstrap',
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
      if ((await this.#posts.put(post)).created) stored += 1
    }
    return stored
  }

  async #runInitialHistoryBackfill(
    baseUrl: string | null,
    force = false,
  ): Promise<{ complete: boolean; pagesFetched: number; postsStored: number }> {
    const current = await this.historyBackfillStatus()
    if (current.complete && !force) return current
    const serialized = await this.#credentials.get(
      'source',
      'history-backfill-cursor',
    )
    let paginationCursor = serialized || undefined
    let pagesFetched = force && current.complete ? 0 : current.pagesFetched
    let postsStored = force && current.complete ? 0 : current.postsStored
    const adapter = this.#createSourceAdapter(baseUrl ?? undefined)
    for (let page = 0; page < 3; page += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      let result
      try {
        result = await adapter.fetchLatest(
          { paginationCursor },
          controller.signal,
        )
      } finally {
        clearTimeout(timeout)
      }
      pagesFetched += 1
      postsStored += await this.#storeHistoricalPosts(result.posts)
      const next = result.cursor.paginationCursor
      const exhausted =
        result.posts.length === 0 || !next || next === paginationCursor
      paginationCursor = exhausted ? undefined : next
      if (paginationCursor)
        await this.#credentials.set(
          'source',
          'history-backfill-cursor',
          paginationCursor,
        )
      else await this.#credentials.delete('source', 'history-backfill-cursor')
      const state = {
        complete: exhausted || page === 2,
        pagesFetched,
        postsStored,
      }
      await this.#credentials.set(
        'source',
        'history-backfill',
        JSON.stringify(state),
      )
      if (state.complete) return state
    }
    return { complete: true, pagesFetched, postsStored }
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

  async #pruneIrrelevantCache(now = Date.now()): Promise<number> {
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
    const deletedPosts = await this.#posts.deleteWhere((post) =>
      expiredPostIds.has(post.postId),
    )
    const deletedAnalyses = await this.#analyses.deleteWhere(
      (analysis) =>
        expiredPostIds.has(analysis.postId) &&
        analysis.relevance === 'irrelevant',
    )
    return deletedPosts + deletedAnalyses
  }

  async #resolveNotificationChannels(
    eventType: AutomationEventType,
  ): Promise<NotificationChannel[]> {
    const enabled = new Set((await this.notificationPolicy())[eventType])
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
    return channels
  }

  async #dispatch(message: NotificationMessage): Promise<Notification[]> {
    return this.#notificationDispatcher.dispatch(message)
  }

  async #autoResumeForEvent(
    event: ResetEvent,
    triggerMode: 'rule-only' | 'rule+ai',
  ): Promise<void> {
    const settings = await this.codexResumeSettings()
    if (!settings.enabled || settings.authorizedThreadIds.length === 0) return
    if (event.status === 'expected') {
      if (!event.expectedStart) return
      this.#schedulePredictionAutomation(event, triggerMode, settings)
      return
    }
    if (event.status !== 'confirmed') return
    await this.#runCodexAutomation(event, triggerMode, settings, 'after-reset')
  }

  #schedulePredictionAutomation(
    event: ResetEvent,
    triggerMode: 'rule-only' | 'rule+ai',
    settings: CodexAutomationSettings,
  ): void {
    if (!event.expectedStart) return
    if (event.expectedEnd && Date.parse(event.expectedEnd) < Date.now()) return
    const maximumTimerDelay = 2_147_000_000
    for (const threadId of settings.authorizedThreadIds) {
      const plan = settings.threadSettings[threadId] ?? settings
      if (!plan.beforePredictionEnabled) continue
      const runAt =
        Date.parse(event.expectedStart) - plan.beforePredictionHours * 3_600_000
      const delay = Math.max(0, runAt - Date.now())
      const timerId = `${event.eventId}--${threadId}`
      const existing = this.#predictionTimers.get(timerId)
      if (existing) clearTimeout(existing)
      if (delay > maximumTimerDelay) {
        // setTimeout cannot wait this long; re-arm later against fresh settings.
        const rearm = setTimeout(() => {
          this.#predictionTimers.delete(timerId)
          void this.#restorePredictionAutomations().catch(() => {})
        }, maximumTimerDelay)
        this.#predictionTimers.set(timerId, rearm)
        continue
      }
      const timer = setTimeout(() => {
        this.#predictionTimers.delete(timerId)
        void this.#runCodexAutomationForThread(
          event,
          triggerMode,
          settings,
          'before-prediction',
          threadId,
        )
      }, delay)
      this.#predictionTimers.set(timerId, timer)
    }
  }

  async #runCodexAutomation(
    event: ResetEvent,
    triggerMode: 'rule-only' | 'rule+ai',
    settings: CodexAutomationSettings,
    phase: 'after-reset' | 'before-prediction',
  ): Promise<void> {
    const eligible = settings.authorizedThreadIds.filter((threadId) => {
      const plan = settings.threadSettings[threadId] ?? settings
      return phase === 'after-reset'
        ? plan.afterResetEnabled
        : plan.beforePredictionEnabled
    })
    for (const threadId of eligible.slice(0, settings.maximumRunsPerCycle))
      await this.#runCodexAutomationForThread(
        event,
        triggerMode,
        settings,
        phase,
        threadId,
      )
  }

  async #runCodexAutomationForThread(
    event: ResetEvent,
    triggerMode: 'rule-only' | 'rule+ai',
    settings: CodexAutomationSettings,
    phase: 'after-reset' | 'before-prediction',
    threadId: string,
  ): Promise<void> {
    const plan = settings.threadSettings[threadId] ?? settings
    if (phase === 'after-reset' && !plan.afterResetEnabled) return
    if (phase === 'before-prediction' && !plan.beforePredictionEnabled) return
    const effectiveSettings = { ...settings, ...plan }
    const resumeId = `${automationCycleId(event, phase)}--${phase}--${threadId}`
    const inflight = this.#codexResumeInflight.get(resumeId)
    if (inflight) {
      await inflight.catch(() => {})
      return
    }
    const run = this.#performAuthorizedResume(
      event,
      triggerMode,
      effectiveSettings,
      plan,
      threadId,
      resumeId,
    ).finally(() => {
      this.#codexResumeInflight.delete(resumeId)
    })
    this.#codexResumeInflight.set(resumeId, run)
    await run
  }

  async #performAuthorizedResume(
    event: ResetEvent,
    triggerMode: 'rule-only' | 'rule+ai',
    effectiveSettings: CodexAutomationSettings,
    plan: CodexThreadAutomationSettings,
    threadId: string,
    resumeId: string,
  ): Promise<void> {
    try {
      await this.#codexResumes.get(resumeId)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const startedAt = new Date().toISOString()
    // Persist the intent before starting so concurrent triggers and restarts
    // observe the run instead of launching it twice.
    await this.#codexResumes.put(
      resumeAudit({
        resumeId,
        eventId: event.eventId,
        threadId,
        triggerMode,
        status: 'started',
        startedAt,
        finishedAt: null,
        turnId: null,
        usedPercent: null,
        errorCode: null,
      }),
    )
    await this.#dispatchResumeNotification(
      event,
      threadId,
      'codex_resume_started',
      '开始恢复已授权的 Codex 任务',
    )
    try {
      const instruction =
        plan.action === 'accelerate' ? plan.accelerationPrompt : undefined
      const { turnId } = await this.#resumeAuthorizedCodexThread(
        threadId,
        instruction,
        effectiveSettings,
      )
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
    | CodexResumeAudit
    | CodexRateLimitObservation,
>(
  rootDirectory: string,
  collection: string,
  idOf: (record: T) => string,
  validate: (record: unknown) => record is T,
) {
  return new JsonRecordStore({ rootDirectory, collection, idOf, validate })
}

async function directorySize(directory: string): Promise<number> {
  let total = 0
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      total += entry.isDirectory()
        ? await directorySize(target)
        : (await stat(target)).size
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return total
}

function prediction(
  events: ResetEvent[],
  posts: Post[],
  hours: number,
): string | null {
  const now = Date.now()
  const limit = now + hours * 60 * 60_000
  const upcoming = currentExpectedEvents(events, posts, now)
    .filter(
      (event) =>
        event.expectedStart && Date.parse(event.expectedStart) <= limit,
    )
    .sort(
      (left, right) =>
        Date.parse(left.expectedStart ?? '') -
        Date.parse(right.expectedStart ?? ''),
    )[0]
  return upcoming ? upcoming.titleZh : null
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/g, ' ').slice(0, 160)
}

function evaluatePost(post: Post): boolean {
  return evaluateRulesV1({
    postId: post.postId,
    excerpt: post.text,
    contentHash: post.contentHash,
  }).candidate
}

export function selectInitialReviewPosts(
  posts: Post[],
  now = Date.now(),
): Post[] {
  const cutoff = now - 7 * 24 * 60 * 60 * 1000
  return [...posts]
    .filter((post) => Date.parse(post.postedAt) >= cutoff)
    .filter((post) => evaluatePost(post))
    .sort((left, right) => right.postedAt.localeCompare(left.postedAt))
}

export function deduplicateEventsByPost(events: ResetEvent[]): ResetEvent[] {
  const selected = new Map<string, ResetEvent>()
  for (const event of events) {
    const existing = selected.get(event.postId)
    const eventIsAi = event.source === 'monitoring-pipeline'
    const existingIsAi = existing?.source === 'monitoring-pipeline'
    if (
      !existing ||
      (eventIsAi && !existingIsAi) ||
      (eventIsAi === existingIsAi && event.createdAt > existing.createdAt)
    )
      selected.set(event.postId, event)
  }
  return [...selected.values()]
}

export function selectLatestExpectedEvent(
  events: ResetEvent[],
  posts: Post[],
  now?: number,
): ResetEvent | undefined {
  const postedAtByPost = new Map(
    posts.map((post) => [post.postId, post.postedAt]),
  )
  return currentExpectedEvents(events, posts, now).sort((left, right) => {
    const postedAtOrder = (
      postedAtByPost.get(right.postId) ?? ''
    ).localeCompare(postedAtByPost.get(left.postId) ?? '')
    return postedAtOrder || right.createdAt.localeCompare(left.createdAt)
  })[0]
}

/**
 * A confirmed reset closes every prediction published at or before it. This
 * makes the dashboard return immediately to the confirmed-reset + 7 day
 * baseline instead of continuing to display a promise that was just fulfilled.
 */
export function currentExpectedEvents(
  events: ResetEvent[],
  posts: Post[],
  now?: number,
): ResetEvent[] {
  const postedAtByPost = new Map(
    posts.map((post) => [post.postId, post.postedAt]),
  )
  const latestConfirmedAt = events
    .filter(
      (event) => event.status === 'confirmed' && event.resetKind !== 'banked',
    )
    .map(
      (event) =>
        event.confirmedAt ??
        postedAtByPost.get(event.postId) ??
        event.createdAt,
    )
    .filter((value) => !Number.isNaN(Date.parse(value)))
    .sort((left, right) => right.localeCompare(left))[0]

  return events.filter((event) => {
    if (event.status !== 'expected' || !event.expectedStart) return false
    if (
      now !== undefined &&
      event.expectedEnd &&
      Date.parse(event.expectedEnd) < now
    )
      return false
    if (!latestConfirmedAt) return true
    const signalPostedAt = postedAtByPost.get(event.postId) ?? event.createdAt
    return Date.parse(signalPostedAt) > Date.parse(latestConfirmedAt)
  })
}

export function buildResetChains(
  events: ResetEvent[],
  posts: Post[],
): DashboardModel['resetChains'] {
  const postsById = new Map(posts.map((post) => [post.postId, post]))
  const ordered = events
    .map((event) => ({ event, post: postsById.get(event.postId) }))
    .filter((item): item is { event: ResetEvent; post: Post } =>
      Boolean(item.post),
    )
    .sort((left, right) =>
      left.post.postedAt.localeCompare(right.post.postedAt),
    )
  const chains: DashboardModel['resetChains'] = []
  const open = new Map<ResetEvent['resetKind'], (typeof chains)[number]>()
  const sevenDays = 7 * 86_400_000

  for (const { event, post } of ordered) {
    let chain = open.get(event.resetKind)
    if (
      chain &&
      Date.parse(post.postedAt) - Date.parse(chain.startedAt) > sevenDays
    ) {
      open.delete(event.resetKind)
      chain = undefined
    }
    if (!chain) {
      chain = {
        id: `${event.resetKind}--${post.postId}`,
        kind: event.resetKind,
        status: 'tracking',
        startedAt: post.postedAt,
        completedAt: null,
        items: [],
      }
      chains.push(chain)
      open.set(event.resetKind, chain)
    }
    chain.items.push({
      eventId: event.eventId,
      postId: post.postId,
      postedAt: post.postedAt,
      status:
        event.status === 'confirmed'
          ? 'confirmed'
          : event.status === 'expected'
            ? 'expected'
            : 'candidate',
      title: event.titleZh,
      text: post.text,
      sourceUrl: post.url,
    })
    if (event.status === 'confirmed') {
      chain.status = 'completed'
      chain.completedAt = post.postedAt
      open.delete(event.resetKind)
    }
  }
  return chains.sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  )
}

function latestAnalysesByPost(analyses: Analysis[]): Map<string, Analysis> {
  const selected = new Map<string, Analysis>()
  for (const analysis of analyses) {
    const existing = selected.get(analysis.postId)
    if (!existing || analysis.createdAt > existing.createdAt)
      selected.set(analysis.postId, analysis)
  }
  return selected
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

function automationCycleId(
  event: ResetEvent,
  phase: 'after-reset' | 'before-prediction',
): string {
  const timestamp =
    phase === 'before-prediction'
      ? (event.expectedStart ?? event.createdAt)
      : (event.confirmedAt ?? event.createdAt)
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))
  return `${event.resetKind}--${day}`
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
