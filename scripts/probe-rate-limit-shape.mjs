import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const exe = process.argv[2]
if (!exe) {
  console.error('usage: node scripts/probe-rate-limit-shape.mjs <codex.exe>')
  process.exit(2)
}
const child = spawn(exe, ['app-server', '--listen', 'stdio://'], {
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
})
let nextId = 1
const pending = new Map()
function request(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`timeout ${method}`))
    }, 10_000)
    pending.set(id, { resolve, reject, timer })
    const frame = { id, method }
    if (params) frame.params = params
    child.stdin.write(`${JSON.stringify(frame)}\n`)
  })
}
const clearPendingTimer = (timer) => globalThis.clearTimeout(timer)
createInterface({ input: child.stdout }).on('line', (line) => {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return
  }
  if (typeof frame.id === 'number') {
    const entry = pending.get(frame.id)
    if (!entry) return
    clearPendingTimer(entry.timer)
    pending.delete(frame.id)
    if (frame.error) entry.reject(new Error(frame.error.message))
    else entry.resolve(frame.result)
  }
})
child.stderr.on('data', () => {})

await request('initialize', {
  clientInfo: { name: 'tibo_probe', title: 'Tibo Probe', version: '0.0.0' },
})
child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)
try {
  const limits = await request('account/rateLimits/read')
  console.log('[rateLimits]', JSON.stringify(limits, null, 2))
} catch (error) {
  console.log('[rateLimits error]', String(error.message))
}
child.kill()
process.exit(0)
