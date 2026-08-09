import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const releaseRoot = path.resolve('release')
const installerPath = path.join(releaseRoot, 'Tibo Watch Setup 0.1.0.exe')
const installDirectory = path.join(releaseRoot, 'verification-install')
const applicationPath = path.join(installDirectory, 'Tibo Watch.exe')
const uninstallerPath = path.join(installDirectory, 'Uninstall Tibo Watch.exe')

async function cleanVerificationDirectory() {
  if (!existsSync(installDirectory)) return
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      rmSync(installDirectory, { recursive: true, force: true })
      return
    } catch (error) {
      if (error.code !== 'EBUSY') throw error
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
  if (readdirSync(installDirectory).length > 0) throw new Error('卸载后验证目录仍包含文件')
  console.warn('卸载器已清空验证目录；Windows 尚未释放空目录句柄')
}

if (!installDirectory.startsWith(`${releaseRoot}${path.sep}`)) {
  throw new Error('拒绝使用 release 目录外的验证安装路径')
}
if (!existsSync(installerPath)) throw new Error(`安装器不存在：${installerPath}`)
if (existsSync(uninstallerPath)) {
  spawnSync(uninstallerPath, ['/S'], { timeout: 120_000, windowsHide: true })
  await new Promise((resolve) => setTimeout(resolve, 3_000))
}
await cleanVerificationDirectory()

function applicationProcesses() {
  const query = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "Get-Process -Name 'Tibo Watch' -ErrorAction SilentlyContinue | Select-Object Id | ConvertTo-Json -Compress",
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  if (query.status !== 0 && query.stderr.trim()) throw new Error(query.stderr)
  if (!query.stdout.trim()) return []
  const parsed = JSON.parse(query.stdout)
  return (Array.isArray(parsed) ? parsed : [parsed]).map(({ Id }) => Id)
}

const install = spawnSync(installerPath, ['/S', `/D=${installDirectory}`], {
  encoding: 'utf8',
  timeout: 120_000,
  windowsHide: true,
})
if (install.status !== 0 || !existsSync(applicationPath)) {
  throw new Error(`静默安装失败：status=${install.status} stderr=${install.stderr}`)
}

const before = new Set(applicationProcesses())
const application = spawn(applicationPath, [], {
  detached: false,
  stdio: 'ignore',
  windowsHide: false,
})

await new Promise((resolve) => setTimeout(resolve, 5_000))
const newIds = applicationProcesses().filter((id) => !before.has(id))
if (newIds.length === 0) throw new Error('安装后的应用未能启动')

spawnSync(
  'powershell.exe',
  ['-NoProfile', '-Command', `Stop-Process -Id ${newIds.join(',')} -Force`],
  { windowsHide: true },
)
if (!application.killed && application.exitCode === null) application.kill()

if (!existsSync(uninstallerPath)) throw new Error('安装目录缺少卸载器')
const uninstall = spawnSync(uninstallerPath, ['/S'], {
  encoding: 'utf8',
  timeout: 120_000,
  windowsHide: true,
})
if (uninstall.status !== 0) throw new Error(`静默卸载失败：${uninstall.stderr}`)

await new Promise((resolve) => setTimeout(resolve, 2_000))
await cleanVerificationDirectory()

console.log(`安装版启动验证通过：pids=${newIds.join(',')}`)
