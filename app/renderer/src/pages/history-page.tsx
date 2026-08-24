import { useState } from 'react'
import type {
  DashboardDetailKind,
  DashboardModel,
} from '../../../domain/dashboard'
import { Empty, PageHeader, PostRow } from '../components/ui'
import {
  chainStageLabel,
  detailName,
  formatTime,
  formatUtc,
  resetKindLabel,
} from '../lib/labels'

export function HistoryPage({ model }: { model: DashboardModel }) {
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

