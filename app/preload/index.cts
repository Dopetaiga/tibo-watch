import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('tiboWatch', {
  platform: process.platform,
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  runBasicSelfTest: () => ipcRenderer.invoke('self-test:run-basic'),
  setSourceEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('source:set-enabled', enabled),
  refresh: () => ipcRenderer.invoke('source:refresh'),
  setDeepSeekKey: (secret: string) =>
    ipcRenderer.invoke('deepseek:set-key', secret),
  deepSeekHint: () => ipcRenderer.invoke('deepseek:hint'),
  testDeepSeek: () => ipcRenderer.invoke('deepseek:test'),
  setAiProvider: (config: {
    protocol: 'anthropic-messages' | 'openai-responses' | 'openai-chat'
    baseUrl: string
    model: string
    apiKey: string
    headers: Record<string, string>
  }) => ipcRenderer.invoke('ai-provider:set', config),
  aiProviderSummary: () => ipcRenderer.invoke('ai-provider:summary'),
  testAiProvider: () => ipcRenderer.invoke('ai-provider:test'),
  codexProbe: () => ipcRenderer.invoke('codex:probe'),
  codexThreads: () => ipcRenderer.invoke('codex:threads'),
  codexResumeSettings: () => ipcRenderer.invoke('codex:resume-settings:get'),
  setCodexResumeSettings: (value: {
    enabled: boolean
    authorizedThreadIds: string[]
    lowerUsedPercent: number
    upperUsedPercent: number
  }) => ipcRenderer.invoke('codex:resume-settings:set', value),
  resumeCodexThread: (threadId: string) =>
    ipcRenderer.invoke('codex:resume', threadId),
  setWebhook: (
    channel: 'feishu' | 'http',
    url: string,
    headers: Record<string, string>,
  ) => ipcRenderer.invoke('webhook:set', channel, url, headers),
  webhookHint: (channel: 'feishu' | 'http') =>
    ipcRenderer.invoke('webhook:hint', channel),
  testWebhook: (channel: 'feishu' | 'http') =>
    ipcRenderer.invoke('webhook:test', channel),
  notificationPolicy: () => ipcRenderer.invoke('notification-policy:get'),
  setNotificationPolicy: (value: Record<string, string[]>) =>
    ipcRenderer.invoke('notification-policy:set', value),
})
