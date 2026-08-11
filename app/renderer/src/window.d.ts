import type { DashboardModel } from '../../domain/dashboard'
import type { SelfTestResult } from '../../domain/self-test'
import type { AiProviderConfig } from '../../adapters/ai/multi-protocol'
import type { CodexThreadSummary } from '../../adapters/codex/app-server'
import type { AutomationEventType } from '../../adapters/notifications/types'

declare global {
  interface Window {
    tiboWatch?: {
      platform: string
      getDashboard(): Promise<DashboardModel>
      runBasicSelfTest(): Promise<SelfTestResult>
      setSourceEnabled(enabled: boolean): Promise<void>
      refresh(): Promise<void>
      setDeepSeekKey(secret: string): Promise<void>
      deepSeekHint(): Promise<string | null>
      testDeepSeek(): Promise<{ ok: boolean; message: string }>
      setAiProvider(config: AiProviderConfig): Promise<void>
      aiProviderSummary(): Promise<{
        configured: boolean
        protocol: AiProviderConfig['protocol'] | null
        baseUrl: string | null
        model: string | null
      }>
      testAiProvider(): Promise<{ ok: boolean; message: string }>
      codexProbe(): Promise<{
        available: boolean
        authenticated: boolean
        accountType: string | null
        rateLimit: {
          usedPercent: number | null
          resetsAt: number | null
          windowDurationMins: number | null
          availableResetCredits: number | null
        } | null
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
      webhookHint(channel: 'feishu' | 'http'): Promise<string | null>
      testWebhook(channel: 'feishu' | 'http'): Promise<{
        status: 'pending' | 'sent' | 'failed' | 'suppressed'
        errorCode: string | null
      }>
      notificationPolicy(): Promise<
        Record<AutomationEventType, Array<'windows' | 'feishu' | 'http'>>
      >
      setNotificationPolicy(
        value: Record<
          AutomationEventType,
          Array<'windows' | 'feishu' | 'http'>
        >,
      ): Promise<void>
    }
  }
}

export {}
