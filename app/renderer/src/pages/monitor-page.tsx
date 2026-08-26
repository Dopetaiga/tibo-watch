import { useDeferredValue, useMemo, useState } from 'react'
import type { DashboardModel } from '../../../domain/dashboard'
import { calendarDays, eventStatistics } from '../dashboard-model'
import {
  Count,
  CycleRail,
  Empty,
  HealthPill,
  Metric,
  PageHeader,
  PostRow,
  SectionTitle,
} from '../components/ui'
import {
  dataStatusLabel,
  formatTime,
  resetCreditSourceLabel,
  showError,
} from '../lib/labels'
import type { DashboardControls } from '../controls'

export function MonitorPage({
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
  // Aggregations render at lower priority so urgent updates stay responsive.
  const deferredEvents = useDeferredValue(model.events)
  const statistics = useMemo(
    () => eventStatistics(deferredEvents),
    [deferredEvents],
  )
  const calendar = useMemo(
    () => calendarDays(deferredEvents, new Date()),
    [deferredEvents],
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
        {model.quotaWindows ? (
          <>
            <Metric
              label="5h 窗口"
              value={`${
                model.quotaWindows.fiveHour.usedPercent ?? '—'
              }% · 刷新 ${
                model.quotaWindows.fiveHour.resetsInMs !== null
                  ? `${Math.max(1, Math.round(model.quotaWindows.fiveHour.resetsInMs / 60_000))}m`
                  : '—'
              }`}
            />
            <Metric
              label="周窗"
              value={`${model.quotaWindows.weekly.usedPercent ?? '—'}% · 刷新 ${
                model.quotaWindows.weekly.resetsInMs !== null
                  ? `${Math.max(1, Math.round(model.quotaWindows.weekly.resetsInMs / 3_600_000))}h`
                  : '—'
              }`}
            />
          </>
        ) : null}
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
            <SectionTitle label="SAVINGS" title="省钱统计" />
            {model.savings && model.savings.windows > 0 ? (
              <>
                <div className="count-row">
                  <Count value={model.savings.windows} label="重置窗口" />
                  <Count
                    value={`${model.savings.savedQuotaPercent}%`}
                    label="免作废消耗"
                  />
                  <Count
                    value={`${model.savings.equivalentFullWindows.toFixed(2)} 个`}
                    label="等效完整窗口"
                  />
                </div>
                <div className="credit-meta">
                  <span>
                    口径：预测/确认重置后至额度刷新前被消耗的额度（否则作废）
                  </span>
                </div>
              </>
            ) : (
              <Empty compact>
                暂无完整的重置窗口样本；确认一次重置并观察到额度刷新后开始累计。
              </Empty>
            )}
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
