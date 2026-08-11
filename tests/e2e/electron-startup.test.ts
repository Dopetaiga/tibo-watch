import { expect, test, _electron as electron } from '@playwright/test'
import path from 'node:path'

test('packaged Windows dashboard starts and renders its safe empty state', async () => {
  const executablePath = path.resolve('release/win-unpacked/Tibo Watch.exe')
  const application = await electron.launch({
    executablePath,
    // The managed Windows test host cannot launch Chromium's sandboxed child
    // processes. Production keeps `sandbox: true`; this flag is test-only.
    args: ['--no-sandbox', '--disable-gpu'],
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
  } finally {
    await application.evaluate(({ app }) => app.quit())
  }
})
