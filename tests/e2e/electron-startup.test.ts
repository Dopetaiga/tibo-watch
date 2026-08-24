import { expect, test, _electron as electron } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

test('packaged Windows dashboard starts with an isolated local profile', async ({
  browserName,
}, testInfo) => {
  void browserName
  const executablePath = path.resolve('release/win-unpacked/Tibo Watch.exe')
  const portableRoot = testInfo.outputPath('portable-root')
  const runtimeDirectory = path.join(
    portableRoot,
    'Tibo Watch Data',
    'data',
    'runtime',
  )
  await mkdir(runtimeDirectory, { recursive: true })
  await writeFile(
    path.join(runtimeDirectory, 'runtime.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      createdAt: '2026-08-12T00:00:00.000Z',
      source: 'e2e-fixture',
      contentHash: '0'.repeat(64),
      stateId: 'runtime',
      lastCheckedAt: null,
      sourceStatus: 'disabled',
      consecutiveFailures: 0,
      pollingIntervalMs: 300_000,
      activeSignalUntil: null,
      lastPostId: null,
    })}\n`,
    'utf8',
  )
  const application = await electron.launch({
    executablePath,
    // Match the user's normal launch path without weakening the app sandbox.
    args: ['--disable-gpu'],
    env: {
      ...process.env,
      PORTABLE_EXECUTABLE_DIR: portableRoot,
      TIBO_WATCH_E2E_MODE: '1',
    },
  })

  try {
    const window = await application.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    expect(await window.title()).toBe('Tibo Watch')
    expect(new URL(window.url()).protocol).toBe('file:')
    await expect(window.getByText('Tibo Watch', { exact: true })).toBeVisible()
    await expect(window.locator('.health-pill')).toBeVisible()
    await expect(
      window.getByRole('heading', { name: '最新消息' }),
    ).toBeVisible()
    await expect(
      window.getByRole('heading', { name: '活动热力图' }),
    ).toBeVisible()
    await expect
      .poll(() =>
        window.evaluate(async () => {
          const api = (
            globalThis as unknown as {
              tiboWatch?: { getDashboard(): Promise<{ health: string }> }
            }
          ).tiboWatch
          return (await api?.getDashboard())?.health
        }),
      )
      .not.toBe('starting')
    const bridge = await window.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          tiboWatch?: { getDashboard(): Promise<unknown> }
        }
      ).tiboWatch
      return {
        keys: Object.keys(api ?? {}).sort(),
        model: await api?.getDashboard(),
      }
    })
    expect(bridge.keys).toEqual(
      [
        'deepSeekHint',
        'aiProviderSummary',
        'codexProbe',
        'codexExecutableHint',
        'codexResumeSettings',
        'codexThreads',
        'getDashboard',
        'historyBackfillStatus',
        'retryHistoryBackfill',
        'notificationPolicy',
        'platform',
        'refresh',
        'runBasicSelfTest',
        'storageStatus',
        'maintainStorage',
        'exportData',
        'chooseCodexExecutable',
        'setDeepSeekKey',
        'setAiProvider',
        'restartApp',
        'setCodexResumeSettings',
        'setSourceEnabled',
        'setCustomSourceEndpoint',
        'sourceConfiguration',
        'setNotificationPolicy',
        'setWebhook',
        'testDeepSeek',
        'testAiProvider',
        'testWebhook',
        'resumeCodexThread',
        'webhookHint',
      ].sort(),
    )
    expect(bridge.model).toMatchObject({
      health: 'disabled',
      monitorMode: 'rule-only',
      events: [],
    })
    await window.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('aside nav button'))
      ;(buttons.at(-1) as HTMLButtonElement | undefined)?.click()
    })
    await window.getByRole('button', { name: '运行基础自检' }).click()
    await expect(
      window.getByRole('status').filter({ hasText: '自检通过' }),
    ).toContainText('5/5')
    await expect(window.getByText('明确的未来重置承诺')).toBeVisible()
    await expect(window.getByText('完全无关的简短回复不应入选')).toBeVisible()
    // Storage quota lives behind the "数据与隐私" settings tab.
    await window.getByRole('button', { name: '数据与隐私' }).click()
    await window.getByRole('button', { name: '查看占用' }).click()
    await expect(window.getByText(/当前占用/)).toBeVisible()
  } finally {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
