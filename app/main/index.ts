import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuntimeController } from './runtime-controller.js'
import type { AiProviderConfig } from '../adapters/ai/multi-protocol.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
let runtime: RuntimeController | null = null

const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
if (portableRoot)
  app.setPath('userData', path.join(portableRoot, 'Tibo Watch Data'))

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.removeMenu()
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  )
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void window.loadFile(path.join(currentDirectory, '../../dist/index.html'))
}

void app.whenReady().then(() => {
  runtime = new RuntimeController(
    path.join(app.getPath('userData'), 'data'),
    async (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body }).show()
    },
  )
  registerIpc(runtime)
  void runtime.restore()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  runtime?.stop()
  app.quit()
})

function registerIpc(controller: RuntimeController): void {
  ipcMain.handle('dashboard:get', () => controller.snapshot())
  ipcMain.handle('self-test:run-basic', () => controller.runBasicSelfTest())
  ipcMain.handle('source:set-enabled', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
    return controller.setSourceEnabled(enabled)
  })
  ipcMain.handle('source:refresh', () => controller.refresh())
  ipcMain.handle('deepseek:set-key', (_event, secret: unknown) => {
    if (typeof secret !== 'string') throw new Error('API Key 必须是字符串')
    return controller.setDeepSeekKey(secret)
  })
  ipcMain.handle('deepseek:hint', () => controller.deepSeekHint())
  ipcMain.handle('deepseek:test', () => controller.testDeepSeek())
  ipcMain.handle('ai-provider:summary', () => controller.aiProviderSummary())
  ipcMain.handle('ai-provider:test', () => controller.testAiProvider())
  ipcMain.handle('ai-provider:set', (_event, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('AI Provider 配置无效')
    return controller.setAiProviderConfig(value as AiProviderConfig)
  })
  ipcMain.handle('codex:probe', () => controller.codexProbe())
  ipcMain.handle('codex:threads', () => controller.codexThreads())
  ipcMain.handle('codex:resume-settings:get', () =>
    controller.codexResumeSettings(),
  )
  ipcMain.handle('codex:resume-settings:set', (_event, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Codex 恢复设置无效')
    return controller.setCodexResumeSettings(
      value as Parameters<RuntimeController['setCodexResumeSettings']>[0],
    )
  })
  ipcMain.handle('codex:resume', (_event, threadId: unknown) => {
    if (typeof threadId !== 'string') throw new Error('Codex 线程 ID 无效')
    return controller.resumeCodexThread(threadId)
  })
  ipcMain.handle(
    'webhook:set',
    (_event, channel: unknown, url: unknown, headers: unknown) => {
      if (channel !== 'feishu' && channel !== 'http')
        throw new Error('Webhook 渠道无效')
      if (typeof url !== 'string') throw new Error('Webhook URL 必须是字符串')
      if (
        !headers ||
        typeof headers !== 'object' ||
        Array.isArray(headers) ||
        !Object.values(headers).every((value) => typeof value === 'string')
      )
        throw new Error('Webhook 请求头必须是字符串对象')
      return controller.setWebhook(
        channel,
        url,
        headers as Record<string, string>,
      )
    },
  )
  ipcMain.handle('webhook:hint', (_event, channel: unknown) => {
    if (channel !== 'feishu' && channel !== 'http')
      throw new Error('Webhook 渠道无效')
    return controller.webhookHint(channel)
  })
  ipcMain.handle('webhook:test', (_event, channel: unknown) => {
    if (channel !== 'feishu' && channel !== 'http')
      throw new Error('Webhook 渠道无效')
    return controller.testWebhook(channel)
  })
  ipcMain.handle('notification-policy:get', () =>
    controller.notificationPolicy(),
  )
  ipcMain.handle('notification-policy:set', (_event, value: unknown) =>
    controller.setNotificationPolicy(value),
  )
}
