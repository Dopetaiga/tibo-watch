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
    await expect(
      window.getByRole('heading', { name: 'Tibo Watch' }),
    ).toBeVisible()
    await expect(window.locator('.health-pill')).toContainText('尚未启用')
    await expect(window.getByText('暂无可靠预测')).toHaveCount(2)
    await expect(
      window.getByRole('heading', { name: '最近帖子' }),
    ).toBeVisible()
    await expect(
      window.getByRole('heading', { name: '事件热力图' }),
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
        'getDashboard',
        'platform',
        'refresh',
        'setDeepSeekKey',
        'setSourceEnabled',
        'setWebhook',
        'testDeepSeek',
        'testWebhook',
        'webhookHint',
      ].sort(),
    )
    expect(bridge.model).toMatchObject({ health: 'disabled', events: [] })
  } finally {
    await application.evaluate(({ app }) => app.quit())
  }
})
