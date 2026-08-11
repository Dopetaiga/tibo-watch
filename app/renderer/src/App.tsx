import { useMemo, useState } from 'react'
import {
  calendarDays,
  eventStatistics,
  type DashboardEvent,
} from './dashboard-model'

type Health = 'healthy' | 'degraded' | 'offline' | 'disabled'

interface DashboardPost {
  id: string
  excerpt: string
  capturedAt: string
  ruleMatched: boolean
  aiCalled: boolean
  formedEvent: boolean
}

type DetailKind = 'post' | 'analysis' | 'event' | 'notification'

export interface DashboardDetail {
  id: string
  title: string
  timestamp: string
  version: string
  sourceUrl?: string
  payload: Record<string, unknown>
}

export interface DashboardModel {
  health: Health
  lastCheckedAt: string | null
  consecutiveFailures: number
  pollingIntervalMinutes: number
  stale: boolean
  prediction24h: string | null
  prediction48h: string | null
  latestSummary: string | null
  latestSourceUrl: string | null
  latestEvidence: string[]
  posts: DashboardPost[]
  events: DashboardEvent[]
  requestLogs: Array<{
    timestamp: string
    target: string
    status: string
    durationMs: number
  }>
  details?: Partial<Record<DetailKind, DashboardDetail[]>>
}

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

export function App({ model = emptyModel }: { model?: DashboardModel }) {
  const [sourceEnabled, setSourceEnabled] = useState(
    model.health !== 'disabled',
  )
  const [aiEnabled, setAiEnabled] = useState(false)
  const [webhooksEnabled, setWebhooksEnabled] = useState(false)
  const [detailTab, setDetailTab] = useState<DetailKind>('post')
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
            onChange={setSourceEnabled}
          />
          <Toggle
            label="DeepSeek 分析"
            checked={aiEnabled}
            onChange={setAiEnabled}
          />
          <Toggle
            label="Webhook 通知"
            checked={webhooksEnabled}
            onChange={setWebhooksEnabled}
          />
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

function detailLabel(kind: DetailKind) {
  return {
    post: '帖子',
    analysis: '分析',
    event: '事件',
    notification: '通知',
  }[kind]
}
