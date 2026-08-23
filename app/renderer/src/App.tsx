import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DashboardDetailKind,
  DashboardModel,
} from '../../domain/dashboard'
import type { SelfTestResult } from '../../domain/self-test'
import type {
  AiProtocol,
  AiProviderConfig,
} from '../../adapters/ai/multi-protocol'
import { DEEPSEEK_PROVIDER_PRESET } from '../../adapters/ai/multi-protocol'
import type { CodexThreadSummary } from '../../adapters/codex/app-server'
import type { CodexThreadAutomationSettings } from '../../domain/codex-budget'
import type { AutomationEventType } from '../../adapters/notifications/types'
import { calendarDays, eventStatistics } from './dashboard-model'

export type { DashboardDetail, DashboardModel } from '../../domain/dashboard'

const emptyModel: DashboardModel = {
  monitorMode: 'rule-only',
  serviceStatus: 'starting',
  dataStatus: 'updating',
  health: 'starting',
  healthMessage: '正在恢复配置与初始化监控',
  lastCheckedAt: null,
  consecutiveFailures: 0,
  pollingIntervalMinutes: 5,
  stale: true,
  lastObservedResetAt: null,
  baselineNextResetAt: null,
  signalPrediction: null,
  prediction24h: null,
  prediction48h: null,
  latestSummary: null,
  latestSourceUrl: null,
  latestEvidence: [],
  resetCredits: {
    availableCount: null,
    nextExpiryAt: null,
    lastUsedAt: null,
    lastUseConfidence: null,
    usesLast28Days: 0,
    expiredLast28Days: 0,
    detailSource: 'unavailable',
  },
  posts: [],
  events: [],
  resetChains: [],
  requestLogs: [],
}

export interface DashboardControls {
  runBasicSelfTest(): Promise<SelfTestResult>
  storageStatus(): Promise<{ bytes: number; records: Record<string, number> }>
  maintainStorage(): Promise<{ deleted: number; indexesRebuilt: number }>
  exportData(): Promise<{ destination: string; records: number } | null>
  setSourceEnabled(enabled: boolean): Promise<void>
  refresh(): Promise<void>
  historyBackfillStatus(): Promise<{
    complete: boolean
    pagesFetched: number
    postsStored: number
  }>
  retryHistoryBackfill(): Promise<{
    complete: boolean
    pagesFetched: number
    postsStored: number
  }>
  sourceConfiguration(): Promise<{ customEndpoint: string | null }>
  setCustomSourceEndpoint(value: string | null): Promise<void>
  setDeepSeekKey(secret: string): Promise<void>
  deepSeekHint(): Promise<string | null>
  testDeepSeek(): Promise<{ ok: boolean; message: string }>
  setAiProvider(config: AiProviderConfig): Promise<void>
  restartApp(): Promise<void>
  testAiProvider(): Promise<{ ok: boolean; message: string }>
  codexProbe(): Promise<{
    available: boolean
    authenticated: boolean
    accountType: string | null
    rateLimit: { usedPercent: number | null } | null
    message: string
  }>
  codexExecutableHint(): Promise<string | null>
  chooseCodexExecutable(): Promise<string | null>
  codexThreads(): Promise<CodexThreadSummary[]>
  codexResumeSettings(): Promise<{
    enabled: boolean
    authorizedThreadIds: string[]
    lowerUsedPercent: number
    upperUsedPercent: number
    afterResetEnabled: boolean
    beforePredictionEnabled: boolean
    beforePredictionHours: number
    maximumRunsPerCycle: number
    targetSpendPercent: number
    minimumRemainingPercent: number
    action: 'resume' | 'accelerate'
    accelerationPrompt: string
    threadSettings: Record<string, CodexThreadAutomationSettings>
  }>
  setCodexResumeSettings(value: {
    enabled: boolean
    authorizedThreadIds: string[]
    lowerUsedPercent: number
    upperUsedPercent: number
    afterResetEnabled: boolean
    beforePredictionEnabled: boolean
    beforePredictionHours: number
    maximumRunsPerCycle: number
    targetSpendPercent: number
    minimumRemainingPercent: number
    action: 'resume' | 'accelerate'
    accelerationPrompt: string
    threadSettings: Record<string, CodexThreadAutomationSettings>
  }): Promise<void>
  resumeCodexThread(threadId: string): Promise<{ turnId: string }>
  setWebhook(
    channel: 'feishu' | 'http',
    url: string,
    headers: Record<string, string>,
  ): Promise<void>
  testWebhook(channel: 'feishu' | 'http'): Promise<{
    status: string
    errorCode: string | null
  }>
  notificationPolicy(): Promise<NotificationPolicy>
  setNotificationPolicy(value: NotificationPolicy): Promise<void>
}

type Page = 'monitor' | 'history' | 'codex' | 'settings'
type NotificationChannelId = 'windows' | 'feishu' | 'http'
type NotificationPolicy = Record<AutomationEventType, NotificationChannelId[]>
type CodexBootstrap = {
  probe: Awaited<ReturnType<DashboardControls['codexProbe']>>
  threads: CodexThreadSummary[]
  settings: Awaited<ReturnType<DashboardControls['codexResumeSettings']>>
  executable: string | null
}
const notificationEvents: AutomationEventType[] = [
  'rule_candidate',
  'ai_confirmed',
  'reset_observed',
  'codex_resume_started',
  'codex_resume_waiting_approval',
  'codex_resume_completed',
  'codex_resume_failed',
]

export function App({
  model = emptyModel,
  controls,
}: {
  model?: DashboardModel
  controls?: DashboardControls
}) {
  const [page, setPage] = useState<Page>('monitor')
  const [codexBootstrap, setCodexBootstrap] = useState<CodexBootstrap | null>(
    null,
  )
  const codexBootstrapStarted = useRef(false)
  useEffect(() => {
    if (!controls || codexBootstrapStarted.current) return
    codexBootstrapStarted.current = true
    let active = true
    void Promise.all([
      controls.codexProbe(),
      controls.codexThreads(),
      controls.codexResumeSettings(),
      controls.codexExecutableHint(),
    ])
      .then(([probe, threads, settings, executable]) => {
        if (active) setCodexBootstrap({ probe, threads, settings, executable })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [controls])
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <span>TW</span>
          <strong>Tibo Watch</strong>
        </div>
        <nav aria-label="主导航">
          <NavButton
            active={page === 'monitor'}
            icon="⌁"
            label="监控"
            onClick={() => setPage('monitor')}
          />
          <NavButton
            active={page === 'history'}
            icon="≡"
            label="历史消息与审计"
            onClick={() => setPage('history')}
          />
          <NavButton
            active={page === 'codex'}
            icon="›_"
            label="Codex"
            onClick={() => setPage('codex')}
          />
          <NavButton
            active={page === 'settings'}
            icon="⚙"
            label="设置"
            onClick={() => setPage('settings')}
          />
        </nav>
        <div className={`sidebar-health ${model.health}`}>
          <span />
          {serviceStatusLabel(model.serviceStatus)}
        </div>
      </aside>
      <main className="workspace">
        {page === 'monitor' && (
          <MonitorPage model={model} controls={controls} />
        )}
        {page === 'history' && <HistoryPage model={model} />}
        {page === 'codex' && (
          <CodexPage
            model={model}
            controls={controls}
            bootstrap={codexBootstrap}
          />
        )}
        {page === 'settings' && (
          <SettingsPage model={model} controls={controls} />
        )}
      </main>
    </div>
  )
}

function MonitorPage({
  model,
  controls,
}: {
  model: DashboardModel
  controls?: DashboardControls
}) {
  const [initializing, setInitializing] = useState(false)
  const [initializationMessage, setInitializationMessage] = useState<
    string | null
  >(null)
  const aiEnhanced = model.monitorMode === 'ai-enhanced'
  const statistics = useMemo(
    () => eventStatistics(model.events),
    [model.events],
  )
  const calendar = useMemo(
    () => calendarDays(model.events, new Date()),
    [model.events],
  )
  const candidates = useMemo(
    () =>
      model.posts.filter(
        (post) => post.ruleMatched || post.relevance === 'relevant',
      ),
    [model.posts],
  )
  return (
    <>
      <PageHeader
        eyebrow="监控"
        title="监控"
        description={
          aiEnhanced
            ? '规则持续筛选，AI 负责解释与预测。'
            : '规则持续筛选；接入 AI 后将补充预测与证据解释。'
        }
        trailing={<HealthPill model={model} />}
      />
      {model.dataStatus === 'disabled' && model.posts.length === 0 ? (
        <section className="surface first-run">
          <div>
            <span>首次使用</span>
            <h2>先建立本地监控基线</h2>
            <p>
              启用数据源并读取最近历史。AI 与 Codex
              都可以稍后配置，规则监控会立即开始工作。
            </p>
          </div>
          <button
            className="primary"
            disabled={!controls || initializing}
            onClick={() => {
              if (!controls) return
              setInitializing(true)
              setInitializationMessage('正在启用数据源…')
              void controls
                .setSourceEnabled(true)
                .then(() => {
                  setInitializationMessage('正在读取最近历史…')
                  return controls.retryHistoryBackfill()
                })
                .then(() => controls.refresh())
                .then(() => setInitializationMessage('初始化完成'))
                .catch(showError(setInitializationMessage))
                .finally(() => setInitializing(false))
            }}
          >
            {initializing ? '正在初始化…' : '启用并初始化'}
          </button>
          {initializationMessage ? (
            <small role="status">{initializationMessage}</small>
          ) : null}
        </section>
      ) : null}
      <section className="status-strip">
        <Metric
          label="数据状态"
          value={dataStatusLabel(model.dataStatus)}
          warning={['stale', 'error'].includes(model.dataStatus)}
        />
        <Metric
          label="数据检查"
          value={
            model.lastCheckedAt ? formatTime(model.lastCheckedAt) : '尚未检查'
          }
        />
        <Metric label="监控模式" value={aiEnhanced ? 'AI 增强' : '仅规则'} />
        <Metric
          label="可用重置卡"
          value={
            model.resetCredits.availableCount === null
              ? '—'
              : `${model.resetCredits.availableCount} 张`
          }
          hint={resetCreditSourceLabel(model.resetCredits.detailSource)}
        />
        <Metric
          label="连续失败"
          value={`${model.consecutiveFailures} 次`}
          warning={model.consecutiveFailures > 0}
        />
      </section>
      <CycleRail model={model} aiEnhanced={aiEnhanced} />
      <section className="two-column">
        <article className="surface messages monitor-feed">
          <SectionTitle
            label="FILTERED FEED"
            title="最新消息"
            action={`${candidates.length} 条候选`}
          />
          {candidates.length ? (
            candidates
              .slice(0, 12)
              .map((post) => <PostRow key={post.id} post={post} />)
          ) : (
            <Empty>暂无有效候选</Empty>
          )}
        </article>
        <div className="stack">
          <article className="surface">
            <SectionTitle label="RESET ACTIVITY" title="重置统计" />
            <div className="count-row">
              <Count value={statistics.all} label="全部" />
              <Count value={statistics.last7} label="近 7 天" />
              <Count value={statistics.last30} label="近 30 天" />
            </div>
          </article>
          <article className="surface">
            <SectionTitle
              label="BANKED RESETS"
              title="重置卡"
              action={resetCreditSourceLabel(model.resetCredits.detailSource)}
            />
            <div className="count-row">
              <Count
                value={model.resetCredits.availableCount ?? '—'}
                label="当前可用"
              />
              <Count
                value={model.resetCredits.usesLast28Days}
                label="近 28 天使用"
              />
              <Count
                value={model.resetCredits.expiredLast28Days}
                label="近 28 天过期"
              />
            </div>
            <div className="credit-meta">
              <span>
                最早过期：
                {model.resetCredits.nextExpiryAt
                  ? formatTime(model.resetCredits.nextExpiryAt)
                  : '暂无明细'}
              </span>
              <span>
                最近使用：
                {model.resetCredits.lastUsedAt
                  ? `${formatTime(model.resetCredits.lastUsedAt)} · ${
                      model.resetCredits.lastUseConfidence === 'confirmed'
                        ? '已确认'
                        : '疑似'
                    }`
                  : '尚未观测到'}
              </span>
            </div>
          </article>
          <article className="surface">
            <SectionTitle label="28 DAYS" title="活动热力图" />
            <div className="calendar" aria-label="最近 28 天确认事件热力图">
              {calendar.map((day) => (
                <div
                  key={day.date}
                  className={`calendar-day level-${Math.min(day.count, 3)}`}
                  title={`${day.date}：${day.count} 次`}
                >
                  <span>{day.day}</span>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </>
  )
}

function CycleRail({
  model,
  aiEnhanced,
}: {
  model: DashboardModel
  aiEnhanced: boolean
}) {
  const prediction = model.signalPrediction
  return (
    <section className="surface cycle-rail" aria-label="本周重置周期">
      <header>
        <div>
          <span>本周周期</span>
          <strong>
            {prediction ? '已捕获新的重置信号' : '等待新的重置信号'}
          </strong>
        </div>
        <small>所有时间均为中国时间</small>
      </header>
      <div className="cycle-track" aria-hidden="true">
        <i className={model.lastObservedResetAt ? 'complete' : ''} />
        <b className={prediction ? 'active' : ''} />
        <i
          className={prediction || model.baselineNextResetAt ? 'forecast' : ''}
        />
      </div>
      <div className="cycle-points">
        <div>
          <span>最近重置</span>
          <strong>
            {model.lastObservedResetAt
              ? formatTime(model.lastObservedResetAt)
              : '尚未观测到'}
          </strong>
        </div>
        <div className={prediction ? 'highlight' : ''}>
          <span>证据来源</span>
          {aiEnhanced && prediction ? (
            <>
              <strong>{prediction.sourceText}</strong>
              {prediction.sourceUrl ? (
                <a href={prediction.sourceUrl} target="_blank" rel="noreferrer">
                  查看原消息 ↗
                </a>
              ) : null}
            </>
          ) : (
            <strong>{aiEnhanced ? '暂无预测证据' : 'AI 未接入'}</strong>
          )}
        </div>
        <div>
          <span>{prediction ? '预测重置时间' : '周重置时间'}</span>
          <strong>
            {prediction
              ? formatWindow(prediction.start, prediction.end)
              : model.baselineNextResetAt
                ? formatTime(model.baselineNextResetAt)
                : '等待首次重置事实'}
          </strong>
        </div>
      </div>
    </section>
  )
}

function HistoryPage({ model }: { model: DashboardModel }) {
  const [showIrrelevant, setShowIrrelevant] = useState(false)
  const [mode, setMode] = useState<'messages' | 'chains' | 'audit'>('messages')
  const [detailTab, setDetailTab] = useState<DashboardDetailKind>('post')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const visible = [...model.posts]
    .filter((post) => showIrrelevant || post.relevance !== 'irrelevant')
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
  const details = model.details?.[detailTab] ?? []
  const selected = details.find((item) => item.id === selectedId) ?? details[0]
  return (
    <>
      <PageHeader
        eyebrow="历史"
        title="历史"
        description="回看 Tibo 原始消息、重置事件链与系统决策记录。"
      />
      <div className="toolbar">
        <div className="segmented">
          <button
            className={mode === 'messages' ? 'active' : ''}
            onClick={() => setMode('messages')}
          >
            消息
          </button>
          <button
            className={mode === 'chains' ? 'active' : ''}
            onClick={() => setMode('chains')}
          >
            重置事件
          </button>
          <button
            className={mode === 'audit' ? 'active' : ''}
            onClick={() => setMode('audit')}
          >
            开发者审计
          </button>
        </div>
        {mode === 'messages' && (
          <label className="check">
            <input
              type="checkbox"
              checked={showIrrelevant}
              onChange={(event) => setShowIrrelevant(event.target.checked)}
            />
            显示保留期内的无关消息
          </label>
        )}
      </div>
      {mode === 'messages' ? (
        <article className="surface history-list">
          {visible.length ? (
            visible.map((post) => <PostRow key={post.id} post={post} />)
          ) : (
            <Empty>暂无符合当前筛选条件的历史消息。</Empty>
          )}
        </article>
      ) : mode === 'chains' ? (
        <article className="surface chain-list">
          {model.resetChains.length ? (
            model.resetChains.map((chain) => (
              <section className="reset-chain" key={chain.id}>
                <header>
                  <div>
                    <strong>{resetKindLabel(chain.kind)}</strong>
                    <small>
                      {formatTime(chain.startedAt)}
                      {chain.completedAt
                        ? ` — ${formatTime(chain.completedAt)}`
                        : ' — 跟踪中'}
                    </small>
                  </div>
                  <span className={chain.status}>
                    {chain.status === 'completed' ? '已闭环' : '跟踪中'}
                  </span>
                </header>
                <ol>
                  {chain.items.map((item) => (
                    <li key={item.eventId}>
                      <time>{formatTime(item.postedAt)}</time>
                      <div>
                        <strong>
                          {chainStageLabel(item.status, chain.kind)}
                        </strong>
                        <p>{item.text}</p>
                        <a href={item.sourceUrl}>查看原帖</a>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))
          ) : (
            <Empty>暂无可以串联的重置事件。</Empty>
          )}
        </article>
      ) : (
        <article className="surface audit-panel">
          <div className="audit-tabs">
            {(
              ['post', 'analysis', 'event', 'notification', 'resume'] as const
            ).map((kind) => (
              <button
                key={kind}
                className={detailTab === kind ? 'active' : ''}
                onClick={() => {
                  setDetailTab(kind)
                  setSelectedId(null)
                }}
              >
                {detailName(kind)}
              </button>
            ))}
          </div>
          {selected ? (
            <div className="audit-browser">
              <nav>
                {details.map((record) => (
                  <button
                    key={record.id}
                    className={record.id === selected.id ? 'active' : ''}
                    onClick={() => setSelectedId(record.id)}
                  >
                    <strong>{record.title}</strong>
                    <small>{formatUtc(record.timestamp)}</small>
                  </button>
                ))}
              </nav>
              <section>
                <header>
                  <div>
                    <strong>{selected.title}</strong>
                    <small>
                      {selected.version} · {formatUtc(selected.timestamp)}
                    </small>
                  </div>
                  {selected.sourceUrl && (
                    <a href={selected.sourceUrl}>打开来源</a>
                  )}
                </header>
                <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
              </section>
            </div>
          ) : (
            <Empty>暂无{detailName(detailTab)}审计记录。</Empty>
          )}
        </article>
      )}
    </>
  )
}

function CodexPage({
  model,
  controls,
  bootstrap,
}: {
  model: DashboardModel
  controls?: DashboardControls
  bootstrap: CodexBootstrap | null
}) {
  const [codexTab, setCodexTab] = useState<'threads' | 'scheduled' | 'policy'>(
    'threads',
  )
  const [message, setMessage] = useState<string | null>(() =>
    bootstrap
      ? `${bootstrap.probe.message}${bootstrap.probe.rateLimit?.usedPercent !== null && bootstrap.probe.rateLimit?.usedPercent !== undefined ? ` · 已用 ${bootstrap.probe.rateLimit.usedPercent}%` : ''}`
      : null,
  )
  const [threads, setThreads] = useState<CodexThreadSummary[]>(
    () => bootstrap?.threads ?? [],
  )
  const [authorized, setAuthorized] = useState<string[]>(
    () => bootstrap?.settings.authorizedThreadIds ?? [],
  )
  const [enabled, setEnabled] = useState(
    () => bootstrap?.settings.enabled ?? false,
  )
  const [lower, setLower] = useState(
    () => bootstrap?.settings.lowerUsedPercent ?? 40,
  )
  const [upper, setUpper] = useState(
    () => bootstrap?.settings.upperUsedPercent ?? 80,
  )
  const [afterReset, setAfterReset] = useState(
    () => bootstrap?.settings.afterResetEnabled ?? true,
  )
  const [beforePrediction, setBeforePrediction] = useState(
    () => bootstrap?.settings.beforePredictionEnabled ?? false,
  )
  const [beforeHours, setBeforeHours] = useState(
    () => bootstrap?.settings.beforePredictionHours ?? 2,
  )
  const [maximumRuns, setMaximumRuns] = useState(
    () => bootstrap?.settings.maximumRunsPerCycle ?? 1,
  )
  const [targetSpend, setTargetSpend] = useState(
    () => bootstrap?.settings.targetSpendPercent ?? 20,
  )
  const [minimumRemaining, setMinimumRemaining] = useState(
    () => bootstrap?.settings.minimumRemainingPercent ?? 20,
  )
  const [action, setAction] = useState<'resume' | 'accelerate'>(
    () => bootstrap?.settings.action ?? 'resume',
  )
  const [accelerationPrompt, setAccelerationPrompt] = useState(
    () => bootstrap?.settings.accelerationPrompt ?? '',
  )
  const [threadSettings, setThreadSettings] = useState<
    Record<string, CodexThreadAutomationSettings>
  >(() => bootstrap?.settings.threadSettings ?? {})
  const [busy, setBusy] = useState(false)
  const [executable, setExecutable] = useState<string | null>(
    () => bootstrap?.executable ?? null,
  )
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const autoScanStarted = useRef(Boolean(bootstrap))

  const authorizedIds = useMemo(() => new Set(authorized), [authorized])
  const managedThreads = useMemo<CodexThreadSummary[]>(() => {
    const knownThreadIds = new Set(threads.map(({ id }) => id))
    return [
      ...threads,
      ...authorized
        .filter((id) => !knownThreadIds.has(id))
        .map((id) => ({
          id,
          name: '已安排的历史任务',
          cwd: null,
          updatedAt: null,
          status: { type: 'unavailable' as const },
        })),
    ]
  }, [authorized, threads])
  const selectedThread = useMemo(
    () => managedThreads.find(({ id }) => id === selectedThreadId),
    [managedThreads, selectedThreadId],
  )
  const scheduledThreads = useMemo(
    () => managedThreads.filter(({ id }) => authorizedIds.has(id)),
    [authorizedIds, managedThreads],
  )
  const latestResumeByThread = useMemo(() => {
    const result = new Map<string, { status: string; detail: string }>()
    const records = [...(model.details?.resume ?? [])].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    )
    for (const record of records) {
      const threadId = record.payload.threadId
      const status = record.payload.status
      if (
        typeof threadId !== 'string' ||
        typeof status !== 'string' ||
        result.has(threadId)
      )
        continue
      const error = record.payload.errorCode
      result.set(threadId, {
        status,
        detail:
          typeof error === 'string' && error
            ? error
            : `最近执行于 ${formatTime(record.timestamp)}`,
      })
    }
    return result
  }, [model.details?.resume])
  const defaultThreadPlan: CodexThreadAutomationSettings = {
    afterResetEnabled: afterReset,
    beforePredictionEnabled: beforePrediction,
    beforePredictionHours: beforeHours,
    targetSpendPercent: targetSpend,
    minimumRemainingPercent: minimumRemaining,
    action,
    accelerationPrompt,
  }
  const selectedPlan = selectedThread
    ? (threadSettings[selectedThread.id] ?? defaultThreadPlan)
    : null

  const settingsValue = (
    nextAuthorized = authorized,
    nextThreadSettings = threadSettings,
  ) => ({
    enabled,
    authorizedThreadIds: nextAuthorized,
    lowerUsedPercent: lower,
    upperUsedPercent: upper,
    afterResetEnabled: afterReset,
    beforePredictionEnabled: beforePrediction,
    beforePredictionHours: beforeHours,
    maximumRunsPerCycle: maximumRuns,
    targetSpendPercent: targetSpend,
    minimumRemainingPercent: minimumRemaining,
    action,
    accelerationPrompt,
    threadSettings: nextThreadSettings,
  })

  const saveSettings = (
    nextAuthorized = authorized,
    notice = '自动任务已保存',
    nextThreadSettings = threadSettings,
  ) => {
    if (!controls) return
    setSaving(true)
    void controls
      .setCodexResumeSettings(settingsValue(nextAuthorized, nextThreadSettings))
      .then(() => {
        setAuthorized(nextAuthorized)
        setThreadSettings(nextThreadSettings)
        setMessage(notice)
      })
      .catch(showError(setMessage))
      .finally(() => setSaving(false))
  }

  const addAutomationTask = (threadId: string) => {
    const nextThreadSettings = {
      ...threadSettings,
      [threadId]: threadSettings[threadId] ?? defaultThreadPlan,
    }
    saveSettings(
      [...new Set([...authorized, threadId])],
      '已加入自动任务',
      nextThreadSettings,
    )
  }

  const removeAutomationTask = (threadId: string) => {
    const nextThreadSettings = { ...threadSettings }
    delete nextThreadSettings[threadId]
    saveSettings(
      authorized.filter((id) => id !== threadId),
      '已从自动任务移除',
      nextThreadSettings,
    )
  }

  const updateThreadPlan = (
    threadId: string,
    patch: Partial<CodexThreadAutomationSettings>,
  ) =>
    setThreadSettings((current) => ({
      ...current,
      [threadId]: {
        ...(current[threadId] ?? defaultThreadPlan),
        ...patch,
      },
    }))

  const detect = useCallback(() => {
    if (!controls) return
    setBusy(true)
    void Promise.all([
      controls.codexProbe(),
      controls.codexThreads(),
      controls.codexResumeSettings(),
      controls.codexExecutableHint(),
    ])
      .then(([probe, listed, settings, path]) => {
        setMessage(
          `${probe.message}${probe.rateLimit?.usedPercent !== null && probe.rateLimit?.usedPercent !== undefined ? ` · 已用 ${probe.rateLimit.usedPercent}%` : ''}`,
        )
        setThreads(listed)
        setAuthorized(settings.authorizedThreadIds)
        setEnabled(settings.enabled)
        setLower(settings.lowerUsedPercent)
        setUpper(settings.upperUsedPercent)
        setAfterReset(settings.afterResetEnabled)
        setBeforePrediction(settings.beforePredictionEnabled)
        setBeforeHours(settings.beforePredictionHours)
        setMaximumRuns(settings.maximumRunsPerCycle)
        setTargetSpend(settings.targetSpendPercent)
        setMinimumRemaining(settings.minimumRemainingPercent)
        setAction(settings.action)
        setAccelerationPrompt(settings.accelerationPrompt)
        setThreadSettings(settings.threadSettings)
        setExecutable(path)
      })
      .catch(showError(setMessage))
      .finally(() => setBusy(false))
  }, [controls])

  useEffect(() => {
    if (autoScanStarted.current || !controls) return
    autoScanStarted.current = true
    detect()
  }, [controls, detect])

  return (
    <>
      <PageHeader
        eyebrow="Codex"
        title="Codex"
        description="选择一个任务立即继续，或把它安排到下一次重置窗口。"
      />
      <div className="codex-workspace">
        <section className="surface codex-connection">
          <div className="codex-connection-state">
            <i className={executable ? 'ready' : ''} />
            <div>
              <strong>{executable ? 'Codex 已连接' : '等待扫描 Codex'}</strong>
              <small>
                {executable ?? '自动查找 Windows Codex 或 PATH 中的 codex'}
              </small>
            </div>
          </div>
          <div className="codex-snapshot" aria-label="Codex 状态概览">
            <span>
              <b>{threads.length}</b> 个任务
            </span>
            <span>
              <b>{scheduledThreads.length}</b> 个自动任务
            </span>
            <span className={enabled ? 'enabled' : ''}>
              自动执行{enabled ? '已开启' : '已关闭'}
            </span>
          </div>
          <div className="codex-connection-actions">
            <button
              className="secondary"
              disabled={!controls}
              onClick={() =>
                void controls
                  ?.chooseCodexExecutable()
                  .then((path) => {
                    if (path) {
                      setExecutable(path)
                      setMessage('Codex 路径已保存')
                    }
                  })
                  .catch(showError(setMessage))
              }
            >
              选择路径
            </button>
            <button
              className="primary"
              disabled={!controls || busy}
              onClick={detect}
            >
              {busy ? '扫描中…' : threads.length ? '重新扫描' : '扫描任务'}
            </button>
          </div>
        </section>
        <nav className="settings-tabs codex-tabs" aria-label="Codex 分类">
          <button
            className={codexTab === 'threads' ? 'active' : ''}
            onClick={() => setCodexTab('threads')}
          >
            会话 <span>{threads.length}</span>
          </button>
          <button
            className={codexTab === 'scheduled' ? 'active' : ''}
            onClick={() => setCodexTab('scheduled')}
          >
            自动任务 <span>{scheduledThreads.length}</span>
          </button>
          <button
            className={codexTab === 'policy' ? 'active' : ''}
            onClick={() => setCodexTab('policy')}
          >
            执行策略
          </button>
        </nav>
        {codexTab === 'threads' ? (
          <section className="surface codex-browser">
            <header className="codex-browser-head">
              <SectionTitle
                label="任务"
                title="选择任务"
                action={`${threads.length}`}
              />
            </header>
            {threads.length ? (
              <div className="codex-thread-list">
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    className={selectedThreadId === thread.id ? 'active' : ''}
                    onClick={() => setSelectedThreadId(thread.id)}
                  >
                    <i className={thread.status.type} />
                    <span>
                      <strong>{thread.name ?? '未命名任务'}</strong>
                      <small>{thread.cwd ?? '未知目录'}</small>
                    </span>
                    <em>
                      {authorizedIds.has(thread.id)
                        ? '自动任务'
                        : threadStatusLabel(thread.status.type)}
                    </em>
                    <b>›</b>
                  </button>
                ))}
              </div>
            ) : (
              <Empty>扫描后选择一个任务进行操作</Empty>
            )}
          </section>
        ) : null}

        {codexTab === 'threads' ? (
          <aside
            className={`surface codex-drawer ${selectedThread ? 'open' : ''}`}
          >
            {selectedThread ? (
              <>
                <header>
                  <div>
                    <small>
                      {threadStatusLabel(selectedThread.status.type)}
                    </small>
                    <h2>{selectedThread.name ?? '未命名任务'}</h2>
                    <p>{selectedThread.cwd ?? '未知目录'}</p>
                  </div>
                  <button
                    aria-label="关闭"
                    onClick={() => setSelectedThreadId(null)}
                  >
                    ×
                  </button>
                </header>
                <div className="drawer-actions">
                  <div className="codex-action-block">
                    <span>手动执行</span>
                    <strong>立即继续这个任务</strong>
                    <small>只发送一次继续指令，不改变自动任务设置。</small>
                    <button
                      className="primary"
                      disabled={
                        !controls ||
                        ['active', 'unavailable'].includes(
                          selectedThread.status.type,
                        )
                      }
                      onClick={() =>
                        void controls
                          ?.resumeCodexThread(selectedThread.id)
                          .then(({ turnId }) =>
                            setMessage(`任务已继续 · ${turnId}`),
                          )
                          .catch(showError(setMessage))
                      }
                    >
                      立即继续
                    </button>
                  </div>
                  <div className="codex-action-block">
                    <span>自动执行</span>
                    <strong>安排到重置窗口</strong>
                    <small>
                      {selectedPlan
                        ? automationSummary(
                            selectedPlan.afterResetEnabled,
                            selectedPlan.beforePredictionEnabled,
                            selectedPlan.beforePredictionHours,
                          )
                        : '未设置'}
                    </small>
                    {authorizedIds.has(selectedThread.id) ? (
                      <button
                        className="secondary"
                        disabled={saving}
                        onClick={() => removeAutomationTask(selectedThread.id)}
                      >
                        移出自动任务
                      </button>
                    ) : (
                      <button
                        className="secondary"
                        disabled={saving}
                        onClick={() => addAutomationTask(selectedThread.id)}
                      >
                        加入自动任务
                      </button>
                    )}
                  </div>
                </div>
                {authorizedIds.has(selectedThread.id) && selectedPlan ? (
                  <section className="thread-plan-editor">
                    <header>
                      <div>
                        <strong>此任务的自动设置</strong>
                        <small>只影响当前任务，不修改其他自动任务。</small>
                      </div>
                    </header>
                    <div className="thread-plan-grid">
                      <Toggle
                        label="确认重置后执行"
                        checked={selectedPlan.afterResetEnabled}
                        onChange={(checked) =>
                          updateThreadPlan(selectedThread.id, {
                            afterResetEnabled: checked,
                          })
                        }
                      />
                      <Toggle
                        label="预测时间前执行"
                        checked={selectedPlan.beforePredictionEnabled}
                        onChange={(checked) =>
                          updateThreadPlan(selectedThread.id, {
                            beforePredictionEnabled: checked,
                          })
                        }
                      />
                      {selectedPlan.beforePredictionEnabled ? (
                        <Field label="提前小时">
                          <input
                            type="number"
                            min="0"
                            max="168"
                            value={selectedPlan.beforePredictionHours}
                            onChange={(event) =>
                              updateThreadPlan(selectedThread.id, {
                                beforePredictionHours: Number(
                                  event.target.value,
                                ),
                              })
                            }
                          />
                        </Field>
                      ) : null}
                      <Field label="执行方式">
                        <select
                          value={selectedPlan.action}
                          onChange={(event) =>
                            updateThreadPlan(selectedThread.id, {
                              action: event.target.value as
                                'resume' | 'accelerate',
                            })
                          }
                        >
                          <option value="resume">继续原任务</option>
                          <option value="accelerate">注入加速提示词</option>
                        </select>
                      </Field>
                      <Field label="至少保留额度 %">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={selectedPlan.minimumRemainingPercent}
                          onChange={(event) =>
                            updateThreadPlan(selectedThread.id, {
                              minimumRemainingPercent: Number(
                                event.target.value,
                              ),
                            })
                          }
                        />
                      </Field>
                      <Field label="单任务额度预留 %">
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={selectedPlan.targetSpendPercent}
                          onChange={(event) =>
                            updateThreadPlan(selectedThread.id, {
                              targetSpendPercent: Number(event.target.value),
                            })
                          }
                        />
                      </Field>
                    </div>
                    {selectedPlan.action === 'accelerate' ? (
                      <Field label="此任务的加速提示词">
                        <textarea
                          value={selectedPlan.accelerationPrompt}
                          onChange={(event) =>
                            updateThreadPlan(selectedThread.id, {
                              accelerationPrompt: event.target.value,
                            })
                          }
                        />
                      </Field>
                    ) : null}
                    <button
                      className="primary"
                      disabled={!controls || saving}
                      onClick={() =>
                        saveSettings(authorized, '此任务的设置已保存')
                      }
                    >
                      {saving ? '保存中…' : '保存此任务设置'}
                    </button>
                  </section>
                ) : null}
                {selectedThread.status.type === 'active' && (
                  <p className="drawer-note">
                    任务正在运行，不会暂停或追加指令。
                  </p>
                )}
                {selectedThread.status.type === 'unavailable' && (
                  <p className="drawer-note">
                    本次扫描未返回该任务，但安排记录仍保留；你可以将它移出自动任务。
                  </p>
                )}
                {!enabled && authorizedIds.has(selectedThread.id) && (
                  <p className="drawer-note">
                    已安排，但自动执行总开关当前关闭。
                  </p>
                )}
              </>
            ) : (
              <Empty>选择左侧任务</Empty>
            )}
          </aside>
        ) : null}

        {codexTab === 'scheduled' ? (
          <section className="surface scheduled-panel codex-tab-panel">
            <SectionTitle
              label="AUTOMATION"
              title="自动任务"
              action={`${scheduledThreads.length}`}
            />
            {scheduledThreads.length ? (
              scheduledThreads.map((thread) => {
                const latest = latestResumeByThread.get(thread.id)
                const plan = threadSettings[thread.id] ?? defaultThreadPlan
                return (
                  <button
                    key={thread.id}
                    onClick={() => setSelectedThreadId(thread.id)}
                  >
                    <span>
                      <strong>{thread.name ?? '未命名任务'}</strong>
                      <small>
                        {enabled
                          ? automationSummary(
                              plan.afterResetEnabled,
                              plan.beforePredictionEnabled,
                              plan.beforePredictionHours,
                            )
                          : '已停用自动执行'}
                        {' · '}
                        {threadStatusLabel(thread.status.type)}
                      </small>
                      {latest ? <small>{latest.detail}</small> : null}
                    </span>
                    <em
                      className={
                        latest?.status === 'completed'
                          ? 'enabled'
                          : (latest?.status ?? (enabled ? 'enabled' : ''))
                      }
                    >
                      {latest
                        ? resumeStatusLabel(latest.status)
                        : enabled
                          ? '等待触发'
                          : '已停用'}
                    </em>
                  </button>
                )
              })
            ) : (
              <Empty compact>尚未安排自动任务</Empty>
            )}
          </section>
        ) : null}

        {codexTab === 'policy' ? (
          <details className="surface automation-policy codex-tab-panel" open>
            <summary>
              <span>
                <strong>队列与新任务默认值</strong>
                <small>
                  {enabled
                    ? automationSummary(
                        afterReset,
                        beforePrediction,
                        beforeHours,
                      )
                    : '总开关已关闭'}
                </small>
              </span>
              <b>设置</b>
            </summary>
            <div className="policy-fields">
              <Toggle
                label="启用自动执行"
                checked={enabled}
                onChange={setEnabled}
              />
              <Toggle
                label="新任务默认：确认重置后执行"
                checked={afterReset}
                onChange={setAfterReset}
              />
              <Toggle
                label="新任务默认：预测时间前执行"
                checked={beforePrediction}
                onChange={setBeforePrediction}
              />
              {beforePrediction && (
                <Field label="提前小时">
                  <input
                    type="number"
                    min="0"
                    max="168"
                    value={beforeHours}
                    onChange={(event) =>
                      setBeforeHours(Number(event.target.value))
                    }
                  />
                </Field>
              )}
              <Field label="执行方式">
                <select
                  value={action}
                  onChange={(event) =>
                    setAction(event.target.value as 'resume' | 'accelerate')
                  }
                >
                  <option value="resume">继续原任务</option>
                  <option value="accelerate">注入加速提示词</option>
                </select>
              </Field>
              {action === 'accelerate' && (
                <Field label="加速提示词">
                  <textarea
                    value={accelerationPrompt}
                    onChange={(event) =>
                      setAccelerationPrompt(event.target.value)
                    }
                  />
                </Field>
              )}
              <div className="budget-row">
                <Field label="每周期最多启动">
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={maximumRuns}
                    onChange={(event) =>
                      setMaximumRuns(Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="至少保留 %">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={minimumRemaining}
                    onChange={(event) =>
                      setMinimumRemaining(Number(event.target.value))
                    }
                  />
                </Field>
              </div>
              <details className="budget-advanced">
                <summary>高级额度门禁</summary>
                <div className="budget-row">
                  <Field label="单任务额度预留 %">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={targetSpend}
                      onChange={(event) =>
                        setTargetSpend(Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="重新允许 ≤ %">
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={lower}
                      onChange={(event) => setLower(Number(event.target.value))}
                    />
                  </Field>
                  <Field label="阻止新执行 ≥ %">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={upper}
                      onChange={(event) => setUpper(Number(event.target.value))}
                    />
                  </Field>
                </div>
              </details>
              <p className="drawer-note">
                额度门禁只阻止新的执行，不会暂停正在运行的任务。
              </p>
              <button
                className="primary"
                disabled={!controls || saving || lower >= upper}
                onClick={() => saveSettings()}
              >
                {saving ? '保存中…' : '保存策略'}
              </button>
            </div>
          </details>
        ) : null}
        {message && (
          <div className="toast" role="status">
            {message}
          </div>
        )}
      </div>
    </>
  )
}

function SettingsPage({
  model,
  controls,
}: {
  model: DashboardModel
  controls?: DashboardControls
}) {
  const sourceEnabled = model.dataStatus !== 'disabled'
  const [settingsTab, setSettingsTab] = useState<
    'general' | 'ai' | 'notifications' | 'data' | 'developer'
  >('general')
  const [message, setMessage] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [aiProtocol, setAiProtocol] = useState<AiProtocol>('openai-chat')
  const [aiService, setAiService] = useState<'deepseek' | 'custom'>('deepseek')
  const [aiBaseUrl, setAiBaseUrl] = useState('https://api.deepseek.com')
  const [aiModel, setAiModel] = useState('deepseek-v4-flash')
  const [aiHeaders, setAiHeaders] = useState('')
  const [channel, setChannel] = useState<'feishu' | 'http'>('feishu')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState('')
  const [selfTest, setSelfTest] = useState<SelfTestResult | null>(null)
  const [storage, setStorage] = useState<{
    bytes: number
    records: Record<string, number>
  } | null>(null)
  const [running, setRunning] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [customEndpoint, setCustomEndpoint] = useState('')
  const [codexThreads, setCodexThreads] = useState<CodexThreadSummary[]>([])
  const [authorizedThreads, setAuthorizedThreads] = useState<string[]>([])
  const [codexEnabled, setCodexEnabled] = useState(false)
  const [lowerBudget, setLowerBudget] = useState(40)
  const [upperBudget, setUpperBudget] = useState(80)
  const [codexBusy, setCodexBusy] = useState(false)
  const [notificationPolicy, setNotificationPolicyState] =
    useState<NotificationPolicy>(
      () =>
        Object.fromEntries(
          notificationEvents.map((eventType) => [
            eventType,
            ['windows', 'feishu', 'http'],
          ]),
        ) as NotificationPolicy,
    )
  const readAiConfig = (): AiProviderConfig => ({
    protocol:
      aiService === 'deepseek' ? DEEPSEEK_PROVIDER_PRESET.protocol : aiProtocol,
    baseUrl:
      aiService === 'deepseek' ? DEEPSEEK_PROVIDER_PRESET.baseUrl : aiBaseUrl,
    model: aiModel,
    apiKey: key,
    headers: aiHeaders.trim()
      ? (JSON.parse(aiHeaders) as Record<string, string>)
      : {},
  })
  const saveAiProvider = () => {
    if (!controls) return
    try {
      const config = readAiConfig()
      void controls
        .setAiProvider(config)
        .then(() => {
          setKey('')
          setAiHeaders('')
          setAiSaved(true)
          setMessage('AI Provider 已安全保存；可重启并用最近信息初始化监控')
        })
        .catch((error) => {
          showError(setMessage)(error)
        })
    } catch {
      setMessage('自定义请求头必须是有效 JSON 对象')
    }
  }
  return (
    <>
      <PageHeader eyebrow="PREFERENCES" title="设置" />
      <section className="settings-layout">
        <nav className="settings-tabs" aria-label="设置分类">
          {(
            [
              ['general', '通用'],
              ['ai', 'AI 判断'],
              ['notifications', '通知'],
              ['data', '数据与隐私'],
              ['developer', '开发者'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={settingsTab === id ? 'active' : ''}
              onClick={() => setSettingsTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <div className="settings-pane" hidden={settingsTab !== 'general'}>
            <SettingSection
              id="source"
              title="监控"
              description="控制公开时间线的更新。"
            >
              <Toggle
                label="启用数据源请求"
                checked={sourceEnabled}
                onChange={(enabled) =>
                  void controls
                    ?.setSourceEnabled(enabled)
                    .catch(showError(setMessage))
                }
              />
              <button
                className="secondary"
                disabled={!controls || !sourceEnabled}
                onClick={() =>
                  void controls
                    ?.refresh()
                    .then(() => setMessage('检查完成'))
                    .catch(showError(setMessage))
                }
              >
                立即检查
              </button>
              <button
                className="secondary"
                disabled={!controls}
                onClick={() =>
                  void controls
                    ?.retryHistoryBackfill()
                    .then(({ pagesFetched, postsStored }) =>
                      setMessage(
                        `FxAPI 历史回填完成：${pagesFetched} 页，新增 ${postsStored} 条消息`,
                      ),
                    )
                    .catch(showError(setMessage))
                }
              >
                重试 FxAPI 历史回填
              </button>
            </SettingSection>
          </div>
          <div className="settings-pane" hidden={settingsTab !== 'developer'}>
            <SettingSection
              id="custom-source"
              title="自定义数据源"
              description="接入兼容的时间线数据服务。"
            >
              <Field label="服务地址" hint="留空恢复内置数据源。">
                <input
                  value={customEndpoint}
                  onChange={(event) => setCustomEndpoint(event.target.value)}
                  placeholder="https://example.com"
                />
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={!controls}
                    onClick={() =>
                      void controls
                        ?.sourceConfiguration()
                        .then(({ customEndpoint: value }) => {
                          setCustomEndpoint(value ?? '')
                          setMessage(
                            value ? '已读取自定义数据源' : '当前使用内置数据源',
                          )
                        })
                        .catch(showError(setMessage))
                    }
                  >
                    读取
                  </button>
                  <button
                    className="primary"
                    disabled={!controls}
                    onClick={() =>
                      void controls
                        ?.setCustomSourceEndpoint(customEndpoint.trim() || null)
                        .then(() =>
                          setMessage(
                            customEndpoint.trim()
                              ? '自定义数据源已保存'
                              : '已恢复内置数据源',
                          ),
                        )
                        .catch(showError(setMessage))
                    }
                  >
                    保存
                  </button>
                </div>
              </Field>
            </SettingSection>
          </div>
          <div className="settings-pane" hidden={settingsTab !== 'developer'}>
            <SettingSection
              id="diagnostics"
              title="基础自检"
              description="使用本地人工复核数据提炼的小样本验证规则链，不联网、不调用 AI、不发送通知、不写入历史。"
            >
              <button
                className="primary"
                disabled={!controls || running}
                onClick={() => {
                  setRunning(true)
                  setSelfTest(null)
                  void controls
                    ?.runBasicSelfTest()
                    .then(setSelfTest)
                    .catch(showError(setMessage))
                    .finally(() => setRunning(false))
                }}
              >
                {running ? '正在自检…' : '运行基础自检'}
              </button>
              {selfTest && (
                <div
                  className={`test-result ${selfTest.ok ? 'success' : 'failure'}`}
                  role="status"
                >
                  <strong>
                    {selfTest.ok ? '自检通过' : '自检失败'} · {selfTest.passed}/
                    {selfTest.total}
                  </strong>
                  <small>
                    {selfTest.ruleVersion} · {selfTest.durationMs}ms
                  </small>
                  {selfTest.checks.map((check) => (
                    <div key={check.id}>
                      <span>{check.passed ? '✓' : '×'}</span>
                      {check.name}
                    </div>
                  ))}
                </div>
              )}
            </SettingSection>
          </div>
          <div className="settings-pane" hidden={settingsTab !== 'ai'}>
            <SettingSection
              id="ai"
              title="判断引擎"
              description="DeepSeek 使用官方预设；自定义兼容服务才需要选择协议和 Base URL。"
            >
              <Field label="服务">
                <select
                  value={aiService}
                  onChange={(event) => {
                    const service = event.target.value as 'deepseek' | 'custom'
                    setAiService(service)
                    if (service === 'deepseek') {
                      setAiProtocol(DEEPSEEK_PROVIDER_PRESET.protocol)
                      setAiBaseUrl(DEEPSEEK_PROVIDER_PRESET.baseUrl)
                      setAiModel(DEEPSEEK_PROVIDER_PRESET.model)
                    }
                  }}
                >
                  <option value="deepseek">DeepSeek 官方 API</option>
                  <option value="custom">自定义兼容服务</option>
                </select>
              </Field>
              {aiService === 'custom' && (
                <Field label="协议">
                  <select
                    value={aiProtocol}
                    onChange={(event) =>
                      setAiProtocol(event.target.value as AiProtocol)
                    }
                  >
                    <option value="openai-responses">
                      OpenAI Responses API
                    </option>
                    <option value="openai-chat">OpenAI Chat Completions</option>
                    <option value="anthropic-messages">
                      Anthropic Messages API
                    </option>
                  </select>
                </Field>
              )}
              {aiService === 'custom' && (
                <Field label="Base URL">
                  <input
                    value={aiBaseUrl}
                    onChange={(event) => setAiBaseUrl(event.target.value)}
                    placeholder="https://api.example.com/v1"
                  />
                </Field>
              )}
              <div className="notice">
                请求地址：
                {aiEndpointPreview(
                  aiService === 'deepseek'
                    ? DEEPSEEK_PROVIDER_PRESET.baseUrl
                    : aiBaseUrl,
                  aiService === 'deepseek'
                    ? DEEPSEEK_PROVIDER_PRESET.protocol
                    : aiProtocol,
                )}
              </div>
              <Field label="模型">
                <input
                  value={aiModel}
                  onChange={(event) => setAiModel(event.target.value)}
                  placeholder="模型名称"
                />
              </Field>
              <Field
                label="API Key"
                hint="Key 与自定义请求头只保存到 Windows 凭据管理器"
              >
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="输入 API Key"
                />
                <textarea
                  value={aiHeaders}
                  onChange={(event) => setAiHeaders(event.target.value)}
                  placeholder='可选请求头 JSON，例如 {"X-Project":"personal"}'
                />
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={
                      !controls ||
                      restarting ||
                      key.trim().length < 8 ||
                      !aiBaseUrl.trim() ||
                      !aiModel.trim()
                    }
                    onClick={saveAiProvider}
                  >
                    安全保存
                  </button>
                  {aiSaved && (
                    <button
                      className="secondary"
                      disabled={!controls || restarting}
                      onClick={() => {
                        if (!controls) return
                        setRestarting(true)
                        setMessage('正在重启并根据最近历史信息初始化监控…')
                        void controls.restartApp().catch((error) => {
                          setRestarting(false)
                          showError(setMessage)(error)
                        })
                      }}
                    >
                      {restarting ? '正在重启…' : '重启并初始化监控'}
                    </button>
                  )}
                  <button
                    className="secondary"
                    disabled={!controls || restarting}
                    onClick={() =>
                      void controls
                        ?.testAiProvider()
                        .then((result) => setMessage(result.message))
                        .catch(showError(setMessage))
                    }
                  >
                    连接测试
                  </button>
                </div>
              </Field>
            </SettingSection>
          </div>
          <div
            className="settings-pane"
            hidden={settingsTab !== 'notifications'}
          >
            <SettingSection
              id="webhooks"
              title="通知与 Webhook"
              description="测试消息会明确标记，不进入真实事件统计。"
            >
              <Field label="通知渠道">
                <select
                  value={channel}
                  onChange={(event) =>
                    setChannel(event.target.value as 'feishu' | 'http')
                  }
                >
                  <option value="feishu">飞书</option>
                  <option value="http">通用 HTTP</option>
                </select>
                <input
                  type="password"
                  autoComplete="off"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="HTTPS Webhook URL"
                />
                {channel === 'http' && (
                  <textarea
                    value={headers}
                    onChange={(event) => setHeaders(event.target.value)}
                    placeholder='可选请求头 JSON，例如 {"Authorization":"Bearer …"}'
                  />
                )}
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={!controls || !url.trim()}
                    onClick={() => {
                      try {
                        const parsed = headers.trim()
                          ? (JSON.parse(headers) as Record<string, string>)
                          : {}
                        void controls
                          ?.setWebhook(channel, url, parsed)
                          .then(() => {
                            setUrl('')
                            setHeaders('')
                            setMessage('Webhook 已安全保存')
                          })
                          .catch(showError(setMessage))
                      } catch {
                        setMessage('请求头必须是有效 JSON 对象')
                      }
                    }}
                  >
                    安全保存
                  </button>
                  <button
                    className="secondary"
                    disabled={!controls}
                    onClick={() =>
                      void controls
                        ?.testWebhook(channel)
                        .then((result) =>
                          setMessage(
                            `测试结果：${result.status}${result.errorCode ? ` · ${result.errorCode}` : ''}`,
                          ),
                        )
                        .catch(showError(setMessage))
                    }
                  >
                    发送测试
                  </button>
                </div>
              </Field>
              <div className="notification-matrix">
                <header>
                  <span>事件类型</span>
                  <span>系统</span>
                  <span>飞书</span>
                  <span>HTTP</span>
                </header>
                {notificationEvents.map((eventType) => (
                  <div key={eventType}>
                    <strong>{eventTypeLabel(eventType)}</strong>
                    {(['windows', 'feishu', 'http'] as const).map((item) => (
                      <input
                        key={item}
                        type="checkbox"
                        checked={notificationPolicy[eventType].includes(item)}
                        onChange={(event) =>
                          setNotificationPolicyState((current) => ({
                            ...current,
                            [eventType]: event.target.checked
                              ? [...new Set([...current[eventType], item])]
                              : current[eventType].filter(
                                  (channelId) => channelId !== item,
                                ),
                          }))
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={!controls}
                  onClick={() =>
                    void controls
                      ?.notificationPolicy()
                      .then(setNotificationPolicyState)
                      .then(() => setMessage('通知策略已读取'))
                      .catch(showError(setMessage))
                  }
                >
                  读取策略
                </button>
                <button
                  className="primary"
                  disabled={!controls}
                  onClick={() =>
                    void controls
                      ?.setNotificationPolicy(notificationPolicy)
                      .then(() => setMessage('各事件通知渠道已保存'))
                      .catch(showError(setMessage))
                  }
                >
                  保存渠道开关
                </button>
              </div>
            </SettingSection>
          </div>
          {legacyCodexSettingsVisible() && (
            <SettingSection
              id="codex"
              title="Codex 账户与恢复"
              description="账户授权与 AI 配置互不依赖。只有这里逐项勾选的线程可以恢复。"
            >
              <div className="notice safety">
                额度阈值只阻止启动新的恢复。Tibo Watch
                绝不暂停、终止或追加指令到正在运行的任务，也不会自动消耗 reset
                credit。
              </div>
              <button
                className="secondary"
                disabled={!controls || codexBusy}
                onClick={() => {
                  setCodexBusy(true)
                  void Promise.all([
                    controls?.codexProbe(),
                    controls?.codexThreads(),
                    controls?.codexResumeSettings(),
                  ])
                    .then(([probe, threads, settings]) => {
                      if (!probe || !threads || !settings) return
                      setMessage(
                        `${probe.message}${probe.rateLimit?.usedPercent !== null && probe.rateLimit?.usedPercent !== undefined ? ` · 已用 ${probe.rateLimit.usedPercent}%` : ''}`,
                      )
                      setCodexThreads(threads)
                      setAuthorizedThreads(settings.authorizedThreadIds)
                      setCodexEnabled(settings.enabled)
                      setLowerBudget(settings.lowerUsedPercent)
                      setUpperBudget(settings.upperUsedPercent)
                    })
                    .catch(showError(setMessage))
                    .finally(() => setCodexBusy(false))
                }}
              >
                {codexBusy ? '正在探测…' : '探测 Codex 并读取任务'}
              </button>
              {codexThreads.length > 0 && (
                <div className="thread-list">
                  {codexThreads.map((thread) => (
                    <label key={thread.id}>
                      <input
                        type="checkbox"
                        checked={authorizedThreads.includes(thread.id)}
                        onChange={(event) =>
                          setAuthorizedThreads((current) =>
                            event.target.checked
                              ? [...new Set([...current, thread.id])]
                              : current.filter((id) => id !== thread.id),
                          )
                        }
                      />
                      <span>
                        <strong>{thread.name ?? '未命名任务'}</strong>
                        <small>
                          {thread.status.type} · {thread.cwd ?? '未知目录'}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <Toggle
                label="允许自动恢复已勾选任务"
                checked={codexEnabled}
                onChange={setCodexEnabled}
              />
              <div className="budget-row">
                <Field label="重新允许启动（已用 ≤ %）">
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={lowerBudget}
                    onChange={(event) =>
                      setLowerBudget(Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="阻止新恢复（已用 ≥ %）">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={upperBudget}
                    onChange={(event) =>
                      setUpperBudget(Number(event.target.value))
                    }
                  />
                </Field>
              </div>
              <button
                className="primary"
                disabled={!controls || lowerBudget >= upperBudget}
                onClick={() =>
                  void controls
                    ?.codexResumeSettings()
                    .then((current) =>
                      controls.setCodexResumeSettings({
                        ...current,
                        enabled: codexEnabled,
                        authorizedThreadIds: authorizedThreads,
                        lowerUsedPercent: lowerBudget,
                        upperUsedPercent: upperBudget,
                      }),
                    )
                    .then(() => setMessage('Codex 恢复授权与额度门禁已保存'))
                    .catch(showError(setMessage))
                }
              >
                保存恢复设置
              </button>
            </SettingSection>
          )}
          <div className="settings-pane" hidden={settingsTab !== 'data'}>
            <SettingSection
              id="storage"
              title="存储与缓存"
              description="无关回复保留 7 天，无关原创和引用保留 14 天；候选、事件和审计长期保留。"
            >
              <div className="notice">
                缓存清理每天低优先级运行一次；候选、事件、通知和审计不会被自动清理。
              </div>
              {storage && (
                <div className="notice">
                  当前占用 {formatBytes(storage.bytes)} · 共{' '}
                  {Object.values(storage.records).reduce(
                    (sum, value) => sum + value,
                    0,
                  )}{' '}
                  条记录
                </div>
              )}
              <div className="button-row">
                <button
                  disabled={!controls}
                  onClick={() =>
                    void controls
                      ?.storageStatus()
                      .then(setStorage)
                      .catch(showError(setMessage))
                  }
                >
                  查看占用
                </button>
                <button
                  disabled={!controls}
                  onClick={() =>
                    void controls
                      ?.maintainStorage()
                      .then((result) => {
                        setMessage(
                          `维护完成：清理 ${result.deleted} 条，重建 ${result.indexesRebuilt} 条索引`,
                        )
                        return controls.storageStatus()
                      })
                      .then(setStorage)
                      .catch(showError(setMessage))
                  }
                >
                  立即清理并重建索引
                </button>
                <button
                  disabled={!controls}
                  onClick={() =>
                    void controls
                      ?.exportData()
                      .then((result) =>
                        setMessage(
                          result
                            ? `已导出 ${result.records} 条记录到 ${result.destination}`
                            : '已取消导出',
                        ),
                      )
                      .catch(showError(setMessage))
                  }
                >
                  导出非敏感数据
                </button>
              </div>
            </SettingSection>
          </div>
          {message && (
            <div className="toast" role="status">
              {message}
            </div>
          )}
        </div>
      </section>
    </>
  )
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: string
  label: string
  onClick(): void
}) {
  return (
    <button
      className={active ? 'active' : ''}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <span>{icon}</span>
      {label}
    </button>
  )
}

function threadStatusLabel(status: string): string {
  if (status === 'active') return '运行中'
  if (status === 'idle') return '可继续'
  if (status === 'archived') return '已归档'
  if (status === 'unavailable') return '本次未扫描到'
  return '空闲'
}

function automationSummary(
  afterReset: boolean,
  beforePrediction: boolean,
  beforeHours: number,
): string {
  const triggers = [
    afterReset ? '重置后' : null,
    beforePrediction ? `预测前 ${beforeHours} 小时` : null,
  ].filter(Boolean)
  return triggers.length ? triggers.join(' · ') : '未选择触发条件'
}

function PageHeader({
  eyebrow,
  title,
  description,
  trailing,
}: {
  eyebrow: string
  title: string
  description?: string
  trailing?: React.ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        {description && <span>{description}</span>}
      </div>
      {trailing}
    </header>
  )
}
function HealthPill({ model }: { model: DashboardModel }) {
  const detail = ['degraded', 'offline'].includes(model.health)
    ? model.healthMessage
    : null
  return (
    <div className={`health-pill ${model.health}`} role="status">
      <i />
      {serviceStatusLabel(model.serviceStatus)}
      {detail ? ` · ${detail}` : ''}
      {model.stale && !['starting', 'disabled'].includes(model.health)
        ? ' · 数据过期'
        : ''}
    </div>
  )
}
function Metric({
  label,
  value,
  warning,
  hint,
}: {
  label: string
  value: string
  warning?: boolean
  hint?: string
}) {
  return (
    <div className={`metric ${warning ? 'warning' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  )
}
function SectionTitle({
  label,
  title,
  action,
}: {
  label: string
  title: string
  action?: string
}) {
  return (
    <header className="section-title">
      <div>
        <p>{label}</p>
        <h2>{title}</h2>
      </div>
      {action && <span>{action}</span>}
    </header>
  )
}
function Count({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function resetCreditSourceLabel(
  source: DashboardModel['resetCredits']['detailSource'],
) {
  if (source === 'api') return '官方明细'
  if (source === 'count-only') return '仅数量'
  if (source === 'inferred') return '规则推断'
  return '尚未授权'
}
function PostRow({ post }: { post: DashboardModel['posts'][number] }) {
  return (
    <a className="post-row" href={post.sourceUrl}>
      <div className={`post-icon ${post.relevance}`}>
        {post.kind === 'reply' ? '↩' : post.kind === 'quote' ? '❞' : '•'}
      </div>
      <div>
        <strong>{post.excerpt}</strong>
        <small>
          {formatTime(post.postedAt)} · {relevanceLabel(post.relevance)}
        </small>
      </div>
      <span>↗</span>
    </a>
  )
}
function Empty({
  children,
  compact,
}: {
  children: React.ReactNode
  compact?: boolean
}) {
  return <div className={`empty ${compact ? 'compact' : ''}`}>{children}</div>
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange(value: boolean): void
}) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i />
    </label>
  )
}
function SettingSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="setting-section">
      <header>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div>{children}</div>
    </section>
  )
}
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="field">
      <strong>{label}</strong>
      {hint && <small>{hint}</small>}
      {children}
    </label>
  )
}
function showError(setter: (value: string) => void) {
  return (error: unknown) =>
    setter(error instanceof Error ? error.message : String(error))
}
function legacyCodexSettingsVisible(): boolean {
  return false
}
function serviceStatusLabel(value: DashboardModel['serviceStatus']) {
  return {
    starting: '服务启动中',
    running: '运行正常',
    stopped: '服务已停止',
  }[value]
}
function dataStatusLabel(value: DashboardModel['dataStatus']) {
  return {
    updating: '正在更新',
    current: '数据已更新',
    stale: '数据已过期',
    error: '更新失败',
    disabled: '数据源已关闭',
  }[value]
}
function relevanceLabel(value: DashboardModel['posts'][number]['relevance']) {
  return {
    candidate: '规则候选',
    relevant: '有效信号',
    related_non_reset: '相关但非重置',
    irrelevant: '无关',
  }[value]
}
function detailName(value: DashboardDetailKind) {
  return {
    post: '帖子',
    analysis: '分析',
    event: '事件',
    notification: '通知',
    resume: 'Codex 恢复',
  }[value]
}

function resetKindLabel(value: 'forced' | 'compensation' | 'banked') {
  return {
    forced: '常规重置',
    compensation: '补偿重置',
    banked: '预存重置权益',
  }[value]
}

function chainStageLabel(
  status: 'candidate' | 'expected' | 'confirmed',
  kind: 'forced' | 'compensation' | 'banked',
) {
  if (status === 'confirmed')
    return kind === 'banked' ? '权益已记录' : '实际重置确认'
  if (status === 'expected') return '明确承诺与预测'
  return '准备或暗示'
}
function eventTypeLabel(value: AutomationEventType): string {
  return {
    rule_candidate: '规则候选',
    ai_confirmed: 'AI 已确认',
    reset_observed: '实际重置',
    codex_resume_started: '恢复开始',
    codex_resume_waiting_approval: '等待批准',
    codex_resume_completed: '恢复完成',
    codex_resume_failed: '恢复失败',
  }[value]
}
function resumeStatusLabel(value: string): string {
  return (
    {
      completed: '最近完成',
      blocked: '已阻止',
      failed: '执行失败',
    }[value] ?? value
  )
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function aiEndpointPreview(baseUrl: string, protocol: AiProtocol): string {
  const suffix = {
    'anthropic-messages': 'messages',
    'openai-responses': 'responses',
    'openai-chat': 'chat/completions',
  }[protocol]
  return `${baseUrl.replace(/\/$/, '')}/${suffix}`
}
function formatUtc(value: string) {
  return new Date(value).toISOString().replace('.000Z', ' UTC')
}
function formatWindow(start: string | null, end: string | null) {
  if (!start && !end) return '尚未给出明确时间窗口'
  return [start && formatTime(start), end && formatTime(end)]
    .filter(Boolean)
    .join(' — ')
}
