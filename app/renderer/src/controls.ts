import type {
  AiProviderConfig,
} from '../../adapters/ai/multi-protocol'
import type { CodexThreadSummary } from '../../adapters/codex/app-server'
import type { AutomationEventType } from '../../adapters/notifications/types'
import type { CodexThreadAutomationSettings } from '../../domain/codex-budget'
import type { SelfTestResult } from '../../domain/self-test'

export type Page = 'monitor' | 'history' | 'codex' | 'settings'
export type NotificationChannelId = 'windows' | 'feishu' | 'http'
export type NotificationPolicy = Record<
  AutomationEventType,
  NotificationChannelId[]
>
export type CodexBootstrap = {
  probe: Awaited<ReturnType<DashboardControls['codexProbe']>>
  threads: CodexThreadSummary[]
  settings: Awaited<ReturnType<DashboardControls['codexResumeSettings']>>
  executable: string | null
}


export const notificationEvents: AutomationEventType[] = [
  'rule_candidate',
  'ai_confirmed',
  'reset_observed',
  'codex_resume_started',
  'codex_resume_waiting_approval',
  'codex_resume_completed',
  'codex_resume_failed',
]

export interface DashboardControls {
  runBasicSelfTest(): Promise<SelfTestResult>
  storageStatus(): Promise<{ bytes: number; records: Record<string, number> }>
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
  testAiProvider(): Promise<{ ok: boolean; message: string }>
  codexProbe(): Promise<{
    available: boolean
    authenticated: boolean
    accountType: string | null
    rateLimit: { usedPercent: number | null } | null
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
    threadSettings: Record<string, CodexThreadAutomationSettings>
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
    threadSettings: Record<string, CodexThreadAutomationSettings>
  }): Promise<void>
  resumeCodexThread(threadId: string): Promise<{ turnId: string }>
  setWebhook(
    channel: 'feishu' | 'http',
    url: string,
    headers: Record<string, string>,
  ): Promise<void>
  testWebhook(channel: 'feishu' | 'http'): Promise<{
    status: string
    errorCode: string | null
  }>
  notificationPolicy(): Promise<NotificationPolicy>
  setNotificationPolicy(value: NotificationPolicy): Promise<void>
}

