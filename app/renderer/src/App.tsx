import { useMemo, useState } from 'react'
import type {
  DashboardDetailKind,
  DashboardModel,
} from '../../domain/dashboard'
import type { SelfTestResult } from '../../domain/self-test'
import type {
  AiProtocol,
  AiProviderConfig,
} from '../../adapters/ai/multi-protocol'
import type { CodexThreadSummary } from '../../adapters/codex/app-server'
import type { AutomationEventType } from '../../adapters/notifications/types'
import { calendarDays, eventStatistics } from './dashboard-model'

export type { DashboardDetail, DashboardModel } from '../../domain/dashboard'

const emptyModel: DashboardModel = {
  health: 'disabled',
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
  posts: [],
  events: [],
  requestLogs: [],
}

export interface DashboardControls {
  runBasicSelfTest(): Promise<SelfTestResult>
  setSourceEnabled(enabled: boolean): Promise<void>
  refresh(): Promise<void>
  setDeepSeekKey(secret: string): Promise<void>
  deepSeekHint(): Promise<string | null>
  testDeepSeek(): Promise<{ ok: boolean; message: string }>
  setAiProvider(config: AiProviderConfig): Promise<void>
  testAiProvider(): Promise<{ ok: boolean; message: string }>
  codexProbe(): Promise<{
    available: boolean
    authenticated: boolean
    accountType: string | null
    rateLimit: { usedPercent: number | null } | null
    message: string
  }>
  codexThreads(): Promise<CodexThreadSummary[]>
  codexResumeSettings(): Promise<{
    enabled: boolean
    authorizedThreadIds: string[]
    lowerUsedPercent: number
    upperUsedPercent: number
  }>
  setCodexResumeSettings(value: {
    enabled: boolean
    authorizedThreadIds: string[]
    lowerUsedPercent: number
    upperUsedPercent: number
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

type Page = 'monitor' | 'history' | 'settings'
type NotificationChannelId = 'windows' | 'feishu' | 'http'
type NotificationPolicy = Record<AutomationEventType, NotificationChannelId[]>
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
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <span>TW</span>
          <div>
            <strong>Tibo Watch</strong>
            <small>Personal signal assistant</small>
          </div>
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
            active={page === 'settings'}
            icon="⚙"
            label="设置"
            onClick={() => setPage('settings')}
          />
        </nav>
        <div className={`sidebar-health ${model.health}`}>
          <span />
          {healthLabel(model.health)}
        </div>
      </aside>
      <main className="workspace">
        {page === 'monitor' && <MonitorPage model={model} />}
        {page === 'history' && <HistoryPage model={model} />}
        {page === 'settings' && (
          <SettingsPage model={model} controls={controls} />
        )}
      </main>
    </div>
  )
}

function MonitorPage({ model }: { model: DashboardModel }) {
  const statistics = useMemo(
    () => eventStatistics(model.events),
    [model.events],
  )
  const calendar = useMemo(
    () => calendarDays(model.events, new Date()),
    [model.events],
  )
  const candidates = model.posts.filter(
    (post) => post.ruleMatched || post.relevance === 'relevant',
  )
  return (
    <>
      <PageHeader
        eyebrow="MONITOR"
        title="监控"
        description="只把真正值得关注的信号留在桌面上。"
        trailing={<HealthPill model={model} />}
      />
      <section className="status-strip">
        <Metric
          label="最近检查"
          value={
            model.lastCheckedAt ? formatTime(model.lastCheckedAt) : '尚未检查'
          }
        />
        <Metric label="运行状态" value={healthLabel(model.health)} />
        <Metric
          label="连续失败"
          value={`${model.consecutiveFailures} 次`}
          warning={model.consecutiveFailures > 0}
        />
        <Metric
          label="轮询间隔"
          value={`${model.pollingIntervalMinutes} 分钟`}
        />
      </section>
      <section className="reset-grid">
        <article className="surface reset-primary">
          <SectionTitle label="LAST OBSERVED" title="最近一次重置" />
          <TimeValue
            value={model.lastObservedResetAt}
            empty="尚未观测到实际重置"
          />
          <p>这是实际观测事实，新的确认事件出现后才会更新。</p>
        </article>
        <article className="surface">
          <SectionTitle label="7-DAY BASELINE" title="下次周期基线" />
          <TimeValue
            value={model.baselineNextResetAt}
            empty="等待首次重置事实"
          />
          <p>按最近实际重置 + 7 天计算，不随当前时间滚动。</p>
        </article>
        <article className="surface signal-card">
          <SectionTitle label="LIVE SIGNAL" title="动态信号" />
          {model.signalPrediction ? (
            <>
              <strong className="signal-title">
                {model.signalPrediction.title}
              </strong>
              <p>
                {formatWindow(
                  model.signalPrediction.start,
                  model.signalPrediction.end,
                )}
              </p>
            </>
          ) : (
            <Empty compact>尚无新的候选信号</Empty>
          )}
        </article>
      </section>
      <section className="two-column">
        <article className="surface messages">
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
            <Empty>规则尚未筛选出有效候选，无关回复不会在这里刷屏。</Empty>
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
            <p className="muted">按系统本地时区统计确认事件。</p>
          </article>
        </div>
      </section>
    </>
  )
}

function HistoryPage({ model }: { model: DashboardModel }) {
  const [showIrrelevant, setShowIrrelevant] = useState(false)
  const [audit, setAudit] = useState(false)
  const [detailTab, setDetailTab] = useState<DashboardDetailKind>('post')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const visible = [...model.posts]
    .filter((post) => showIrrelevant || post.relevance !== 'irrelevant')
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  const details = model.details?.[detailTab] ?? []
  const selected = details.find((item) => item.id === selectedId) ?? details[0]
  return (
    <>
      <PageHeader
        eyebrow="HISTORY"
        title="历史消息与审计"
        description="按最新时间倒序查看发言，并追溯每一步判断。"
      />
      <div className="toolbar">
        <div className="segmented">
          <button
            className={!audit ? 'active' : ''}
            onClick={() => setAudit(false)}
          >
            历史消息
          </button>
          <button
            className={audit ? 'active' : ''}
            onClick={() => setAudit(true)}
          >
            审计记录
          </button>
        </div>
        {!audit && (
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
      {!audit ? (
        <article className="surface history-list">
          {visible.length ? (
            visible.map((post) => <PostRow key={post.id} post={post} />)
          ) : (
            <Empty>暂无符合当前筛选条件的历史消息。</Empty>
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

function SettingsPage({
  model,
  controls,
}: {
  model: DashboardModel
  controls?: DashboardControls
}) {
  const sourceEnabled = model.health !== 'disabled'
  const [message, setMessage] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [aiProtocol, setAiProtocol] = useState<AiProtocol>('openai-chat')
  const [aiBaseUrl, setAiBaseUrl] = useState('https://api.deepseek.com')
  const [aiModel, setAiModel] = useState('deepseek-chat')
  const [aiHeaders, setAiHeaders] = useState('')
  const [channel, setChannel] = useState<'feishu' | 'http'>('feishu')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState('')
  const [selfTest, setSelfTest] = useState<SelfTestResult | null>(null)
  const [running, setRunning] = useState(false)
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
  return (
    <>
      <PageHeader
        eyebrow="PREFERENCES"
        title="设置"
        description="数据源、判断、账户、恢复、通知和存储彼此独立。"
      />
      <section className="settings-layout">
        <nav className="settings-index">
          <a href="#source">数据源</a>
          <a href="#diagnostics">诊断</a>
          <a href="#ai">判断引擎</a>
          <a href="#webhooks">通知与 Webhook</a>
          <a href="#codex">Codex 账户与恢复</a>
          <a href="#storage">存储与缓存</a>
        </nav>
        <div className="settings-content">
          <SettingSection
            id="source"
            title="数据源"
            description="公开时间线的轮询开关；关闭后不会发出新请求。"
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
          </SettingSection>
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
          <SettingSection
            id="ai"
            title="判断引擎"
            description="Messages、Responses 和 Chat Completions 使用统一分析结构；配置与 OpenAI 账户授权互不依赖。"
          >
            <Field label="协议">
              <select
                value={aiProtocol}
                onChange={(event) =>
                  setAiProtocol(event.target.value as AiProtocol)
                }
              >
                <option value="openai-responses">OpenAI Responses API</option>
                <option value="openai-chat">OpenAI Chat Completions</option>
                <option value="anthropic-messages">
                  Anthropic Messages API
                </option>
              </select>
            </Field>
            <Field label="Base URL">
              <input
                value={aiBaseUrl}
                onChange={(event) => setAiBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </Field>
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
                    key.trim().length < 8 ||
                    !aiBaseUrl.trim() ||
                    !aiModel.trim()
                  }
                  onClick={() => {
                    try {
                      const customHeaders = aiHeaders.trim()
                        ? (JSON.parse(aiHeaders) as Record<string, string>)
                        : {}
                      void controls
                        ?.setAiProvider({
                          protocol: aiProtocol,
                          baseUrl: aiBaseUrl,
                          model: aiModel,
                          apiKey: key,
                          headers: customHeaders,
                        })
                        .then(() => {
                          setKey('')
                          setAiHeaders('')
                          setMessage('AI Provider 已安全保存')
                        })
                        .catch(showError(setMessage))
                    } catch {
                      setMessage('自定义请求头必须是有效 JSON 对象')
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
                  ?.setCodexResumeSettings({
                    enabled: codexEnabled,
                    authorizedThreadIds: authorizedThreads,
                    lowerUsedPercent: lowerBudget,
                    upperUsedPercent: upperBudget,
                  })
                  .then(() => setMessage('Codex 恢复授权与额度门禁已保存'))
                  .catch(showError(setMessage))
              }
            >
              保存恢复设置
            </button>
          </SettingSection>
          <SettingSection
            id="storage"
            title="存储与缓存"
            description="无关回复保留 7 天，无关原创和引用保留 14 天；候选、事件和审计长期保留。"
          >
            <div className="notice">
              缓存清理将在 V2-6 启用；现阶段不删除现有用户数据。
            </div>
          </SettingSection>
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
function PageHeader({
  eyebrow,
  title,
  description,
  trailing,
}: {
  eyebrow: string
  title: string
  description: string
  trailing?: React.ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      {trailing}
    </header>
  )
}
function HealthPill({ model }: { model: DashboardModel }) {
  return (
    <div className={`health-pill ${model.health}`} role="status">
      <i />
      {healthLabel(model.health)}
      {model.stale && model.health !== 'disabled' ? ' · 数据过期' : ''}
    </div>
  )
}
function Metric({
  label,
  value,
  warning,
}: {
  label: string
  value: string
  warning?: boolean
}) {
  return (
    <div className={`metric ${warning ? 'warning' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
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
function TimeValue({ value, empty }: { value: string | null; empty: string }) {
  return (
    <strong className="time-value">{value ? formatTime(value) : empty}</strong>
  )
}
function Count({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
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
          {formatTime(post.capturedAt)} · {relevanceLabel(post.relevance)}
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
function healthLabel(value: DashboardModel['health']) {
  return {
    healthy: '运行正常',
    degraded: '服务降级',
    offline: '网络离线',
    disabled: '尚未启用',
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
function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
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
