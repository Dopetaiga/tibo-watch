import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const portablePath = path.resolve('release/Tibo Watch-0.1.0-portable.exe')

if (!existsSync(portablePath)) {
  throw new Error(`便携版不存在：${portablePath}`)
}

function relevantProcesses() {
  const query = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'Tibo Watch' } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress",
    ],
    { encoding: 'utf8', windowsHide: true },
  )

  if (query.status !== 0) throw new Error(query.stderr || '无法读取进程状态')
  if (!query.stdout.trim()) return []
  const parsed = JSON.parse(query.stdout)
  return Array.isArray(parsed) ? parsed : [parsed]
}

const before = new Set(relevantProcesses().map(({ Id }) => Id))
const launcher = spawn(portablePath, [], {
  detached: false,
  stdio: 'ignore',
  windowsHide: false,
})

const deadline = Date.now() + 45_000
let started = []

while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  started = relevantProcesses().filter(({ Id }) => !before.has(Id))
  if (started.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const liveIds = new Set(relevantProcesses().map(({ Id }) => Id))
    started = started.filter(({ Id }) => liveIds.has(Id))
    if (started.length > 0) break
  }
}

const newIds = started.map(({ Id }) => Id)
if (newIds.length > 0) {
  spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Stop-Process -Id ${newIds.join(',')} -Force`],
    { windowsHide: true },
  )
}

if (!launcher.killed && launcher.exitCode === null) launcher.kill()

const runningApplication = started[0]
if (!runningApplication) {
  throw new Error(`便携版未在 45 秒内显示主窗口；新进程：${JSON.stringify(started)}`)
}

console.log(`便携版启动验证通过：pid=${runningApplication.Id}`)
