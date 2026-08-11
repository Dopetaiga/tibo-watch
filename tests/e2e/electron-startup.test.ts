import { expect, test, _electron as electron } from '@playwright/test'
import path from 'node:path'

test('packaged Windows dashboard starts and renders its safe empty state', async () => {
  const executablePath = path.resolve('release/win-unpacked/Tibo Watch.exe')
  const application = await electron.launch({
    executablePath,
    // Match the user's normal launch path without weakening the app sandbox.
    args: ['--disable-gpu'],
    env: {
      ...process.env,
      PORTABLE_EXECUTABLE_DIR: path.resolve('test-results/portable-root'),
    },
  })

  try {
    const window = await application.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    expect(await window.title()).toBe('Tibo Watch')
    expect(new URL(window.url()).protocol).toBe('file:')
    await expect(window.getByText('Tibo Watch', { exact: true })).toBeVisible()
    await expect(window.locator('.health-pill')).toContainText('尚未启用')
    await expect(
      window.getByRole('heading', { name: '最新消息' }),
    ).toBeVisible()
    await expect(
      window.getByRole('heading', { name: '活动热力图' }),
    ).toBeVisible()
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
        'codexResumeSettings',
        'codexThreads',
        'getDashboard',
        'notificationPolicy',
        'platform',
        'refresh',
        'runBasicSelfTest',
        'setDeepSeekKey',
        'setAiProvider',
        'setCodexResumeSettings',
        'setSourceEnabled',
        'setNotificationPolicy',
        'setWebhook',
        'testDeepSeek',
        'testAiProvider',
        'testWebhook',
        'resumeCodexThread',
        'webhookHint',
      ].sort(),
    )
    expect(bridge.model).toMatchObject({ health: 'disabled', events: [] })
    await window.getByRole('button', { name: '设置', exact: true }).click()
    await window.getByRole('button', { name: '运行基础自检' }).click()
    await expect(
      window.getByRole('status').filter({ hasText: '自检通过' }),
    ).toContainText('5/5')
    await expect(window.getByText('明确的未来重置承诺')).toBeVisible()
    await expect(window.getByText('完全无关的简短回复不应入选')).toBeVisible()
  } finally {
    await application.evaluate(({ app }) => app.quit())
  }
})
