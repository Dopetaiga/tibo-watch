import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App, type DashboardControls } from './App'
import type { DashboardModel } from '../../domain/dashboard'
import './styles.css'

const root = document.getElementById('root')

if (!root) throw new Error('缺少应用根节点')

export function RuntimeApp() {
  const [model, setModel] = useState<DashboardModel | undefined>()
  const reload = useCallback(async () => {
    if (window.tiboWatch) setModel(await window.tiboWatch.getDashboard())
  }, [])
  useEffect(() => {
    const initial = window.setTimeout(() => void reload(), 0)
    const timer = window.setInterval(() => void reload(), 2_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [reload])
  const controls = useMemo<DashboardControls | undefined>(
    () =>
      window.tiboWatch
        ? {
            setSourceEnabled: async (enabled) => {
              await window.tiboWatch!.setSourceEnabled(enabled)
              await reload()
            },
            runBasicSelfTest: () => window.tiboWatch!.runBasicSelfTest(),
            storageStatus: () => window.tiboWatch!.storageStatus(),
            maintainStorage: () => window.tiboWatch!.maintainStorage(),
            exportData: () => window.tiboWatch!.exportData(),
            refresh: async () => {
              await window.tiboWatch!.refresh()
              await reload()
            },
            historyBackfillStatus: () =>
              window.tiboWatch!.historyBackfillStatus(),
            retryHistoryBackfill: async () => {
              const result = await window.tiboWatch!.retryHistoryBackfill()
              await reload()
              return result
            },
            sourceConfiguration: () => window.tiboWatch!.sourceConfiguration(),
            setCustomSourceEndpoint: (value) =>
              window.tiboWatch!.setCustomSourceEndpoint(value),
            setDeepSeekKey: (secret) =>
              window.tiboWatch!.setDeepSeekKey(secret),
            deepSeekHint: () => window.tiboWatch!.deepSeekHint(),
            testDeepSeek: () => window.tiboWatch!.testDeepSeek(),
            setAiProvider: (config) => window.tiboWatch!.setAiProvider(config),
            restartApp: () => window.tiboWatch!.restartApp(),
            testAiProvider: () => window.tiboWatch!.testAiProvider(),
            codexProbe: () => window.tiboWatch!.codexProbe(),
            codexExecutableHint: () => window.tiboWatch!.codexExecutableHint(),
            chooseCodexExecutable: () =>
              window.tiboWatch!.chooseCodexExecutable(),
            codexThreads: () => window.tiboWatch!.codexThreads(),
            codexResumeSettings: () => window.tiboWatch!.codexResumeSettings(),
            setCodexResumeSettings: (value) =>
              window.tiboWatch!.setCodexResumeSettings(value),
            resumeCodexThread: (threadId) =>
              window.tiboWatch!.resumeCodexThread(threadId),
            setWebhook: (channel, url, headers) =>
              window.tiboWatch!.setWebhook(channel, url, headers),
            testWebhook: (channel) => window.tiboWatch!.testWebhook(channel),
            notificationPolicy: () => window.tiboWatch!.notificationPolicy(),
            setNotificationPolicy: (value) =>
              window.tiboWatch!.setNotificationPolicy(value),
          }
        : undefined,
    [reload],
  )
  return <App model={model} controls={controls} />
}

createRoot(root).render(
  <StrictMode>
    <RuntimeApp />
  </StrictMode>,
)
