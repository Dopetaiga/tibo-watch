import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'

const releaseRoot = path.resolve('release')
const installerPath = path.join(releaseRoot, 'Tibo Watch Setup 0.1.0.exe')
const installDirectory = path.join(releaseRoot, 'verification-install')
const userDataRoot = path.join(releaseRoot, 'verification-user-data')
const applicationPath = path.join(installDirectory, 'Tibo Watch.exe')
const uninstallerPath = path.join(installDirectory, 'Uninstall Tibo Watch.exe')
const runtimeRecord = path.join(
  userDataRoot,
  'Tibo Watch Data',
  'data',
  'runtime',
  'runtime.json',
)

for (const target of [installDirectory, userDataRoot]) {
  if (!target.startsWith(`${releaseRoot}${path.sep}`))
    throw new Error(`拒绝使用 release 目录外的验证路径：${target}`)
}
if (!existsSync(installerPath))
  throw new Error(`安装器不存在：${installerPath}`)
await removeWithRetry(installDirectory)
await removeWithRetry(userDataRoot)

install()
await launchAndPersist()
if (!existsSync(runtimeRecord)) throw new Error('首次启动未持久化运行状态')

// Reinstall over the same directory to exercise the upgrade path.
install()
await launchAndVerifyRestore()

if (!existsSync(uninstallerPath)) throw new Error('安装目录缺少卸载器')
const uninstall = spawnSync(uninstallerPath, ['/S'], {
  encoding: 'utf8',
  timeout: 120_000,
  windowsHide: true,
})
if (uninstall.status !== 0) throw new Error(`静默卸载失败：${uninstall.stderr}`)
if (!existsSync(runtimeRecord)) throw new Error('卸载不应删除用户运行数据')

await removeWithRetry(installDirectory)
await removeWithRetry(userDataRoot)
console.log('安装版验证通过：首次启动、覆盖升级、状态恢复、卸载与数据保留')

function install() {
  const result = spawnSync(installerPath, ['/S', `/D=${installDirectory}`], {
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })
  if (result.status !== 0 || !existsSync(applicationPath))
    throw new Error(
      `静默安装失败：status=${result.status} stderr=${result.stderr}`,
    )
}

async function launch() {
  return electron.launch({
    executablePath: applicationPath,
    args: ['--disable-gpu'],
    env: { ...process.env, PORTABLE_EXECUTABLE_DIR: userDataRoot },
  })
}

async function launchAndPersist() {
  const application = await launch()
  try {
    const window = await application.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.evaluate(async () => {
      const api = globalThis.tiboWatch
      if (!api) throw new Error('preload API 不可用')
      await api.setSourceEnabled(false)
    })
  } finally {
    await application.evaluate(({ app }) => app.quit())
  }
}

async function launchAndVerifyRestore() {
  const application = await launch()
  try {
    const window = await application.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    const model = await window.evaluate(async () => {
      const api = globalThis.tiboWatch
      if (!api) throw new Error('preload API 不可用')
      return api.getDashboard()
    })
    if (model.health !== 'disabled') throw new Error('升级后运行状态恢复失败')
  } finally {
    await application.evaluate(({ app }) => app.quit())
  }
}

async function removeWithRetry(target) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      if (!['EBUSY', 'EPERM'].includes(error.code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
  throw new Error(`Windows 未释放验证目录：${target}`)
}
