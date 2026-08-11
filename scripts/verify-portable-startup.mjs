import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const portablePath = path.resolve('release/Tibo Watch-0.1.0-portable.exe')
if (!existsSync(portablePath)) throw new Error(`便携版不存在：${portablePath}`)

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
const launcher = spawn(portablePath, ['--disable-gpu'], {
  detached: false,
  stdio: 'ignore',
  windowsHide: false,
})
const deadline = Date.now() + 45_000
let started = []

while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  started = relevantProcesses().filter(
    ({ Id, MainWindowTitle }) =>
      !before.has(Id) && /Tibo Watch/i.test(MainWindowTitle ?? ''),
  )
  if (started.length > 0) break
}

const runningApplication = started[0]
if (!runningApplication) {
  throw new Error(
    `便携版未在 45 秒内显示主窗口；新进程：${JSON.stringify(
      relevantProcesses().filter(({ Id }) => !before.has(Id)),
    )}`,
  )
}

const close = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Get-Process -Id ${runningApplication.Id} -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }`,
  ],
  { windowsHide: true },
)
if (close.status !== 0) throw new Error(`无法关闭便携版窗口：${close.stderr}`)

const closeDeadline = Date.now() + 15_000
while (Date.now() < closeDeadline) {
  if (!relevantProcesses().some(({ Id }) => Id === runningApplication.Id)) break
  await new Promise((resolve) => setTimeout(resolve, 500))
}
if (relevantProcesses().some(({ Id }) => Id === runningApplication.Id))
  throw new Error('便携版收到窗口关闭请求后仍未退出')
if (!launcher.killed && launcher.exitCode === null) launcher.kill()

console.log(`便携版启动与优雅退出验证通过：pid=${runningApplication.Id}`)
