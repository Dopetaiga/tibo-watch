import { useMemo, useState } from 'react'
import { calendarDays, eventStatistics } from './dashboard-model'
import type {
  DashboardDetailKind,
  DashboardModel,
} from '../../domain/dashboard'

export type { DashboardDetail, DashboardModel } from '../../domain/dashboard'

const emptyModel: DashboardModel = {
  health: 'disabled',
  lastCheckedAt: null,
  consecutiveFailures: 0,
  pollingIntervalMinutes: 5,
  stale: true,
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
  setSourceEnabled(enabled: boolean): Promise<void>
  refresh(): Promise<void>
  setDeepSeekKey(secret: string): Promise<void>
  deepSeekHint(): Promise<string | null>
  testDeepSeek(): Promise<{ ok: boolean; message: string }>
  setWebhook(
    channel: 'feishu' | 'http',
    url: string,
    headers: Record<string, string>,
  ): Promise<void>
  testWebhook(channel: 'feishu' | 'http'): Promise<{
    status: string
    errorCode: string | null
  }>
}

export function App({
  model = emptyModel,
  controls,
}: {
  model?: DashboardModel
  controls?: DashboardControls
}) {
  const sourceEnabled = model.health !== 'disabled'
  const [deepSeekKey, setDeepSeekKey] = useState('')
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  )
  const [webhookChannel, setWebhookChannel] = useState<'feishu' | 'http'>(
    'feishu',
  )
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookHeaders, setWebhookHeaders] = useState('')
  const [detailTab, setDetailTab] = useState<DashboardDetailKind>('post')
  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null)
  const statistics = useMemo(
    () => eventStatistics(model.events),
    [model.events],
  )
  const calendar = useMemo(
    () => calendarDays(model.events, new Date()),
    [model.events],
  )
  const detailRecords = model.details?.[detailTab] ?? []
  const selectedDetail =
    detailRecords.find(({ id }) => id === selectedDetailId) ?? detailRecords[0]
  const healthLabel = {
    healthy: '运行正常',
    degraded: '服务降级',
    offline: '网络离线',
    disabled: '尚未启用',
  }[model.health]

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">LOCAL SIGNAL DESK · WINDOWS</p>
          <h1>Tibo Watch</h1>
          <p className="subtitle">
            只监控公开发言，研究数据与运行数据严格隔离。
          </p>
        </div>
        <div
          className={`health-pill ${model.health}`}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true" />
          {healthLabel}
          {model.stale && model.health !== 'disabled' ? ' · 数据已过期' : ''}
        </div>
      </header>

      <section className="metric-grid" aria-label="监控健康">
        <Metric
          label="最后检查"
          value={
            model.lastCheckedAt ? formatTime(model.lastCheckedAt) : '尚未检查'
          }
        />
        <Metric
          label="连续失败"
          value={`${model.consecutiveFailures} 次`}
          tone={model.consecutiveFailures ? 'warning' : undefined}
        />
        <Metric
          label="当前轮询"
          value={`${model.pollingIntervalMinutes} 分钟`}
        />
        <Metric
          label="数据状态"
          value={model.stale ? '过期 / 未就绪' : '实时'}
          tone={model.stale ? 'warning' : 'good'}
        />
      </section>

      <section className="prediction-grid" aria-label="24 与 48 小时判断">
        <PredictionCard hours="24 小时" value={model.prediction24h} />
        <PredictionCard hours="48 小时" value={model.prediction48h} />
        <article className="panel latest-judgement">
          <PanelHeading kicker="LATEST JUDGEMENT" title="最新判断" />
          {model.latestSummary ? (
            <>
              <p className="judgement-copy">{model.latestSummary}</p>
              <ul>
                {model.latestEvidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {model.latestSourceUrl && (
                <a href={model.latestSourceUrl}>打开 X 原帖</a>
              )}
            </>
          ) : (
            <EmptyState>尚无经过规则与 AI 双重验证的判断</EmptyState>
          )}
        </article>
      </section>

      <section className="content-grid">
        <article className="panel posts-panel">
          <PanelHeading kicker="INGESTION" title="最近帖子" />
          {model.posts.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>帖子</th>
                    <th>规则</th>
                    <th>AI</th>
                    <th>事件</th>
                  </tr>
                </thead>
                <tbody>
                  {model.posts.map((post) => (
                    <tr key={post.id}>
                      <td>
                        <strong>{post.excerpt}</strong>
                        <small>
                          {formatTime(post.capturedAt)} · {post.id}
                        </small>
                      </td>
                      <td>{yesNo(post.ruleMatched)}</td>
                      <td>{yesNo(post.aiCalled)}</td>
                      <td>{yesNo(post.formedEvent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>
              启用数据源后，新帖子将在这里显示采集与筛选状态
            </EmptyState>
          )}
        </article>

        <article className="panel timeline-panel">
          <PanelHeading kicker="CONFIRMED ONLY" title="历史重置事件" />
          {model.events.length ? (
            model.events.map((event) => (
              <div className="timeline-item" key={event.id}>
                <span />
                <div>
                  <strong>{event.title}</strong>
                  <small>
                    {formatTime(event.occurredAt)} · {event.type}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <EmptyState>尚无已确认历史事件</EmptyState>
          )}
        </article>
      </section>

      <section className="analytics-grid">
        <article className="panel stats-panel">
          <PanelHeading kicker="EVENT COUNTS" title="重置次数统计" />
          <div className="stats-row">
            <Stat label="全部" value={statistics.all} />
            <Stat label="近 7 天" value={statistics.last7} />
            <Stat label="近 30 天" value={statistics.last30} />
          </div>
          <div className="legend">
            <span className="forced">forced {statistics.forced}</span>
            <span className="compensation">
              compensation {statistics.compensation}
            </span>
            <span className="banked">banked {statistics.banked}</span>
          </div>
        </article>
        <article className="panel calendar-panel">
          <PanelHeading kicker="LOCAL CALENDAR" title="事件热力图" />
          <div className="calendar" aria-label="最近 28 天确认事件热力图">
            {calendar.map((day) => (
              <div
                key={day.date}
                className={`calendar-day level-${Math.min(day.count, 3)}`}
                title={`${day.date}：${day.count} 个已确认事件`}
                aria-label={`${day.date}，${day.count} 个事件`}
              >
                <span>{day.day}</span>
              </div>
            ))}
          </div>
          <p className="timezone-note">
            按系统本地时区分组；详情同时保留 UTC 时间。
          </p>
        </article>
      </section>

      <section className="bottom-grid">
        <article className="panel detail-panel">
          <PanelHeading kicker="AUDIT TRAIL" title="详情检查器" />
          <div className="tabs" role="tablist" aria-label="详情类型">
            {(
              [
                ['post', '帖子'],
                ['analysis', '分析'],
                ['event', '事件'],
                ['notification', '通知'],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                role="tab"
                aria-selected={detailTab === kind}
                onClick={() => {
                  setDetailTab(kind)
                  setSelectedDetailId(null)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {selectedDetail ? (
            <div className="detail-browser">
              <nav aria-label="详情记录">
                {detailRecords.map((record) => (
                  <button
                    key={record.id}
                    aria-pressed={record.id === selectedDetail.id}
                    onClick={() => setSelectedDetailId(record.id)}
                  >
                    <strong>{record.title}</strong>
                    <small>{formatUtc(record.timestamp)}</small>
                  </button>
                ))}
              </nav>
              <section aria-label={`${selectedDetail.title}详情`}>
                <header>
                  <div>
                    <strong>{selectedDetail.title}</strong>
                    <small>
                      {formatUtc(selectedDetail.timestamp)} ·{' '}
                      {selectedDetail.version}
                    </small>
                  </div>
                  {selectedDetail.sourceUrl && (
                    <a href={selectedDetail.sourceUrl}>打开来源</a>
                  )}
                </header>
                <pre>{JSON.stringify(selectedDetail.payload, null, 2)}</pre>
              </section>
            </div>
          ) : (
            <EmptyState>
              暂无{detailLabel(detailTab)}记录；生成后可查看原始
              JSON、版本和证据
            </EmptyState>
          )}
        </article>
        <article className="panel settings-panel">
          <PanelHeading kicker="LOCAL CONTROLS" title="设置与请求日志" />
          <Toggle
            label="数据源请求"
            checked={sourceEnabled}
            onChange={(enabled) => {
              void controls
                ?.setSourceEnabled(enabled)
                .catch((error) => setConnectionMessage(String(error)))
            }}
          />
          <div className="credential-control">
            <label htmlFor="deepseek-key">DeepSeek API Key</label>
            <small>无需密钥文件；安全保存后写入 Windows 凭据管理器。</small>
            <input
              id="deepseek-key"
              type="password"
              autoComplete="off"
              value={deepSeekKey}
              placeholder="仅保存到 Windows 凭据管理器"
              onChange={(event) => setDeepSeekKey(event.target.value)}
            />
            <div>
              <button
                disabled={!controls || deepSeekKey.trim().length < 16}
                onClick={() => {
                  void controls
                    ?.setDeepSeekKey(deepSeekKey)
                    .then(() => {
                      setDeepSeekKey('')
                      setConnectionMessage('DeepSeek Key 已安全保存')
                    })
                    .catch((error) => setConnectionMessage(String(error)))
                }}
              >
                安全保存
              </button>
              <button
                disabled={!controls}
                onClick={() => {
                  void controls
                    ?.testDeepSeek()
                    .then(({ message }) => setConnectionMessage(message))
                    .catch((error) => setConnectionMessage(String(error)))
                }}
              >
                连接测试
              </button>
              <button
                disabled={!controls || !sourceEnabled}
                onClick={() =>
                  void controls
                    ?.refresh()
                    .catch((error) => setConnectionMessage(String(error)))
                }
              >
                立即检查
              </button>
            </div>
            {connectionMessage && (
              <small role="status">{connectionMessage}</small>
            )}
          </div>
          <div className="credential-control">
            <label htmlFor="webhook-url">通知 Webhook</label>
            <small>飞书建议使用只有自己的私密群和自定义机器人。</small>
            <select
              value={webhookChannel}
              onChange={(event) =>
                setWebhookChannel(event.target.value as 'feishu' | 'http')
              }
            >
              <option value="feishu">飞书</option>
              <option value="http">通用 HTTP</option>
            </select>
            <input
              id="webhook-url"
              type="password"
              autoComplete="off"
              value={webhookUrl}
              placeholder="HTTPS webhook；仅保存到 Windows 凭据管理器"
              onChange={(event) => setWebhookUrl(event.target.value)}
            />
            {webhookChannel === 'http' && (
              <textarea
                value={webhookHeaders}
                placeholder={
                  '可选请求头 JSON，例如 {"Authorization":"Bearer …"}'
                }
                onChange={(event) => setWebhookHeaders(event.target.value)}
              />
            )}
            <div>
              <button
                disabled={!controls || !webhookUrl.trim()}
                onClick={() => {
                  try {
                    const headers = webhookHeaders.trim()
                      ? (JSON.parse(webhookHeaders) as Record<string, string>)
                      : {}
                    void controls
                      ?.setWebhook(webhookChannel, webhookUrl, headers)
                      .then(() => {
                        setWebhookUrl('')
                        setWebhookHeaders('')
                        setConnectionMessage(
                          `${webhookChannel} webhook 已安全保存`,
                        )
                      })
                      .catch((error) => setConnectionMessage(String(error)))
                  } catch {
                    setConnectionMessage('请求头必须是有效 JSON 对象')
                  }
                }}
              >
                安全保存
              </button>
              <button
                disabled={!controls}
                onClick={() =>
                  void controls
                    ?.testWebhook(webhookChannel)
                    .then(({ status, errorCode }) =>
                      setConnectionMessage(
                        `测试结果：${status}${errorCode ? ` · ${errorCode}` : ''}`,
                      ),
                    )
                    .catch((error) => setConnectionMessage(String(error)))
                }
              >
                发送测试
              </button>
            </div>
          </div>
          <div className="request-log">
            <strong>最近请求</strong>
            {model.requestLogs.length ? (
              model.requestLogs.map((log) => (
                <code key={`${log.timestamp}-${log.target}`}>
                  {formatTime(log.timestamp)} {log.target} {log.status}{' '}
                  {log.durationMs}ms
                </code>
              ))
            ) : (
              <small>暂无请求；日志不会记录密钥或完整 webhook。</small>
            )}
          </div>
        </article>
      </section>
    </main>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: string
}) {
  return (
    <article className={`metric ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}
function PredictionCard({
  hours,
  value,
}: {
  hours: string
  value: string | null
}) {
  return (
    <article className="panel prediction-card">
      <PanelHeading kicker="SIGNAL WINDOW" title={hours} />
      <div className={value ? 'prediction-value' : 'empty-prediction'}>
        {value ?? '暂无可靠预测'}
      </div>
      <small>仅基于有效近期信号，不按历史间隔虚构概率。</small>
    </article>
  )
}
function PanelHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <header className="panel-heading">
      <p>{kicker}</p>
      <h2>{title}</h2>
    </header>
  )
}
function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="empty-state">{children}</div>
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
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
      <i aria-hidden="true" />
    </label>
  )
}
function yesNo(value: boolean) {
  return value ? '是' : '否'
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

function detailLabel(kind: DashboardDetailKind) {
  return {
    post: '帖子',
    analysis: '分析',
    event: '事件',
    notification: '通知',
  }[kind]
}
