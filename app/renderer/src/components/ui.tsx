import { memo } from 'react'
import type { DashboardModel } from '../../../domain/dashboard'
import {
  formatTime,
  formatWindow,
  relevanceLabel,
  serviceStatusLabel,
} from '../lib/labels'

export function NavButton({
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

export function PageHeader({
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
export function HealthPill({ model }: { model: DashboardModel }) {
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
export function Metric({
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
export function SectionTitle({
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
export function Count({
  value,
  label,
}: {
  value: number | string
  label: string
}) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

export const PostRow = memo(function PostRow({
  post,
}: {
  post: DashboardModel['posts'][number]
}) {
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
})
export function Empty({
  children,
  compact,
}: {
  children: React.ReactNode
  compact?: boolean
}) {
  return <div className={`empty ${compact ? 'compact' : ''}`}>{children}</div>
}
export function Toggle({
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
export function SettingSection({
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
export function Field({
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

export function CycleRail({
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
            {prediction
              ? '已捕获新的重置信号'
              : model.lastInferredResetAt
                ? '预测窗口已到，等待确认'
                : '等待新的重置信号'}
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
          <span>最近确认重置</span>
          <strong>
            {model.lastObservedResetAt
              ? formatTime(model.lastObservedResetAt)
              : '尚未观测到'}
          </strong>
          {model.lastInferredResetAt ? (
            <small>推定重置：{formatTime(model.lastInferredResetAt)}</small>
          ) : null}
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
            <strong>
              {model.lastInferredResetAt
                ? '尚未观测到确认帖或官方额度事实'
                : aiEnhanced
                  ? '暂无预测证据'
                  : 'AI 未接入'}
            </strong>
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
