import { expect, test, _electron as electron } from '@playwright/test'
import path from 'node:path'

test('packaged Windows shell starts and renders its safe empty state', async () => {
  const executablePath = path.resolve('release/win-unpacked/Tibo Watch.exe')
  const application = await electron.launch({ executablePath })

  try {
    const window = await application.firstWindow()
    await expect(window.getByRole('heading', { name: 'Tibo Watch' })).toBeVisible()
    await expect(window.getByRole('status')).toHaveText('暂无可靠预测')
  } finally {
    await application.close()
  }
})
