import { StrictMode, useCallback, useEffect, useState } from 'react'
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
    const timer = window.setInterval(() => void reload(), 15_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [reload])
  const controls: DashboardControls | undefined = window.tiboWatch
    ? {
        setSourceEnabled: async (enabled) => {
          await window.tiboWatch!.setSourceEnabled(enabled)
          await reload()
        },
        refresh: async () => {
          await window.tiboWatch!.refresh()
          await reload()
        },
        setDeepSeekKey: (secret) => window.tiboWatch!.setDeepSeekKey(secret),
        deepSeekHint: () => window.tiboWatch!.deepSeekHint(),
        testDeepSeek: () => window.tiboWatch!.testDeepSeek(),
      }
    : undefined
  return <App model={model} controls={controls} />
}

createRoot(root).render(
  <StrictMode>
    <RuntimeApp />
  </StrictMode>,
)
