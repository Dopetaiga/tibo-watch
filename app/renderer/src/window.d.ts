import type { DashboardModel } from '../../domain/dashboard'

declare global {
  interface Window {
    tiboWatch?: {
      platform: string
      getDashboard(): Promise<DashboardModel>
      setSourceEnabled(enabled: boolean): Promise<void>
      refresh(): Promise<void>
      setDeepSeekKey(secret: string): Promise<void>
      deepSeekHint(): Promise<string | null>
      testDeepSeek(): Promise<{ ok: boolean; message: string }>
    }
  }
}

export {}
