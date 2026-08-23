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
      storageStatus(): Promise<{
        bytes: number
        records: Record<string, number>
      }>
      maintainStorage(): Promise<{ deleted: number; indexesRebuilt: number }>
      exportData(): Promise<{ destination: string; records: number } | null>
      setSourceEnabled(enabled: boolean): Promise<void>
      refresh(): Promise<void>
      historyBackfillStatus(): Promise<{
        complete: boolean
        pagesFetched: number
        postsStored: number
      }>
      retryHistoryBackfill(): Promise<{
        complete: boolean
        pagesFetched: number
        postsStored: number
      }>
      sourceConfiguration(): Promise<{ customEndpoint: string | null }>
      setCustomSourceEndpoint(value: string | null): Promise<void>
      setDeepSeekKey(secret: string): Promise<void>
      deepSeekHint(): Promise<string | null>
      testDeepSeek(): Promise<{ ok: boolean; message: string }>
      setAiProvider(config: AiProviderConfig): Promise<void>
      restartApp(): Promise<void>
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
          resetCredits: Array<{
            id: string
            grantedAt: number
            expiresAt: number | null
            status: 'available' | 'redeeming' | 'redeemed' | 'unknown'
            resetType: 'codexRateLimits' | 'unknown'
            title: string | null
            description: string | null
          }> | null
        } | null
        message: string
      }>
      codexExecutableHint(): Promise<string | null>
      chooseCodexExecutable(): Promise<string | null>
      codexThreads(): Promise<CodexThreadSummary[]>
      codexResumeSettings(): Promise<{
        enabled: boolean
        authorizedThreadIds: string[]
        lowerUsedPercent: number
        upperUsedPercent: number
        afterResetEnabled: boolean
        beforePredictionEnabled: boolean
        beforePredictionHours: number
        maximumRunsPerCycle: number
        targetSpendPercent: number
        minimumRemainingPercent: number
        action: 'resume' | 'accelerate'
        accelerationPrompt: string
        threadSettings: Record<
          string,
          {
            afterResetEnabled: boolean
            beforePredictionEnabled: boolean
            beforePredictionHours: number
            targetSpendPercent: number
            minimumRemainingPercent: number
            action: 'resume' | 'accelerate'
            accelerationPrompt: string
          }
        >
      }>
      setCodexResumeSettings(value: {
        enabled: boolean
        authorizedThreadIds: string[]
        lowerUsedPercent: number
        upperUsedPercent: number
        afterResetEnabled: boolean
        beforePredictionEnabled: boolean
        beforePredictionHours: number
        maximumRunsPerCycle: number
        targetSpendPercent: number
        minimumRemainingPercent: number
        action: 'resume' | 'accelerate'
        accelerationPrompt: string
        threadSettings: Record<
          string,
          {
            afterResetEnabled: boolean
            beforePredictionEnabled: boolean
            beforePredictionHours: number
            targetSpendPercent: number
            minimumRemainingPercent: number
            action: 'resume' | 'accelerate'
            accelerationPrompt: string
          }
        >
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
