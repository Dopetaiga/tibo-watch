import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { DashboardModel } from '../../domain/dashboard'
import { NavButton } from './components/ui'
import { serviceStatusLabel } from './lib/labels'
import type { CodexBootstrap, DashboardControls, Page } from './controls'

export type { DashboardControls } from './controls'
export type { DashboardDetail, DashboardModel } from '../../domain/dashboard'

const MonitorPage = lazy(() =>
  import('./pages/monitor-page').then((m) => ({ default: m.MonitorPage })),
)
const HistoryPage = lazy(() =>
  import('./pages/history-page').then((m) => ({ default: m.HistoryPage })),
)
const CodexPage = lazy(() =>
  import('./pages/codex-page').then((m) => ({ default: m.CodexPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/settings-page').then((m) => ({ default: m.SettingsPage })),
)

const emptyModel: DashboardModel = {
  monitorMode: 'rule-only',
  serviceStatus: 'starting',
  dataStatus: 'disabled',
  health: 'starting',
  healthMessage: '正在恢复配置与初始化监控',
  lastCheckedAt: null,
  consecutiveFailures: 0,
  pollingIntervalMinutes: 5,
  stale: true,
  savings: null,
  codexRuns: { completed28d: 0, failed28d: 0, blocked28d: 0 },
  lastObservedResetAt: null,
  lastInferredResetAt: null,
  baselinePreviousResetAt: null,
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
    void Promise.allSettled([
      controls.codexProbe(),
      controls.codexThreads(),
      controls.codexResumeSettings(),
      controls.codexExecutableHint(),
    ]).then(([probe, threads, settings, executable]) => {
      if (!active || settings.status !== 'fulfilled') return
      setCodexBootstrap({
        probe:
          probe.status === 'fulfilled'
            ? probe.value
            : {
                available: false,
                authenticated: false,
                accountType: null,
                rateLimit: null,
                message: 'Codex 尚不可用',
              },
        threads: threads.status === 'fulfilled' ? threads.value : [],
        settings: settings.value,
        executable: executable.status === 'fulfilled' ? executable.value : null,
      })
    })
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
        <Suspense fallback={<div className="page-loading">加载中…</div>}>
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
        </Suspense>
      </main>
    </div>
  )
}
