import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  screen,
  shell,
} from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuntimeController } from './runtime-controller.js'
import type { AiProviderConfig } from '../adapters/ai/multi-protocol.js'
import { ensureV2MigrationBackup } from '../adapters/storage/v2-migration.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
let runtime: RuntimeController | null = null

const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
if (portableRoot)
  app.setPath('userData', path.join(portableRoot, 'Tibo Watch Data'))

const hasSingleInstanceLock = app.requestSingleInstanceLock()

function createWindow(): void {
  const { width: workWidth, height: workHeight } =
    screen.getPrimaryDisplay().workAreaSize
  const window = new BrowserWindow({
    width: Math.min(1440, Math.floor(workWidth * 0.94)),
    height: Math.min(960, Math.floor(workHeight * 0.94)),
    minWidth: 900,
    minHeight: 680,
    center: true,
    show: false,
    webPreferences: {
      preload: path.join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
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

void app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  try {
    const dataRoot = path.join(app.getPath('userData'), 'data')
    await ensureV2MigrationBackup(dataRoot)
    runtime = new RuntimeController(dataRoot, async (title, body) => {
      if (!Notification.isSupported())
        throw new Error('当前 Windows 系统不支持应用通知')
      new Notification({ title, body }).show()
    })
    registerIpc(runtime)
    void runtime.restore()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (error) {
    dialog.showErrorBox('Tibo Watch 启动失败', startupErrorMessage(error))
    app.exit(1)
  }
})

app.on('second-instance', () => {
  const [existing] = BrowserWindow.getAllWindows()
  if (!existing) return
  if (existing.isMinimized()) existing.restore()
  existing.focus()
})

function startupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500)
}

app.on('window-all-closed', () => {
  runtime?.stop()
  app.quit()
})

function registerIpc(controller: RuntimeController): void {
  ipcMain.handle('dashboard:get', () => controller.snapshot())
  ipcMain.handle('self-test:run-basic', () => controller.runBasicSelfTest())
  ipcMain.handle('storage:status', () => controller.storageStatus())
  ipcMain.handle('storage:maintain', () => controller.maintainStorage())
  ipcMain.handle('storage:export', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择本地数据导出文件夹',
      properties: ['openDirectory', 'createDirectory'],
    })
    const destination = result.filePaths[0]
    if (!destination) return null
    return {
      destination,
      records: await controller.exportData(destination),
    }
  })
  ipcMain.handle('source:set-enabled', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
    return controller.setSourceEnabled(enabled)
  })
  ipcMain.handle('source:refresh', () => controller.refresh())
  ipcMain.handle('history:backfill-status', () =>
    controller.historyBackfillStatus(),
  )
  ipcMain.handle('history:backfill-retry', () =>
    controller.retryHistoryBackfill(),
  )
  ipcMain.handle('source:configuration', () => controller.sourceConfiguration())
  ipcMain.handle('source:set-custom-endpoint', (_event, value: unknown) => {
    if (value !== null && typeof value !== 'string')
      throw new Error('自定义数据源地址无效')
    return controller.setCustomSourceEndpoint(value)
  })
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
  ipcMain.handle('app:restart', () => {
    setImmediate(() => {
      app.relaunch()
      app.exit(0)
    })
  })
  ipcMain.handle('codex:probe', () => controller.codexProbe())
  ipcMain.handle('codex:executable:hint', () =>
    controller.codexExecutableHint(),
  )
  ipcMain.handle('codex:executable:choose', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Codex CLI 可执行文件',
      properties: ['openFile'],
      filters: [{ name: 'Codex CLI', extensions: ['exe'] }],
    })
    const selected = result.filePaths[0]
    if (!selected) return null
    await controller.setCodexExecutablePath(selected)
    return selected
  })
  ipcMain.handle('codex:threads', () => controller.codexThreads())
  ipcMain.handle('codex:dry-run', (_event, threadId: unknown) => {
    if (typeof threadId !== 'string') throw new Error('Codex 线程 ID 无效')
    return controller.codexDryRun(threadId)
  })
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
