#!/usr/bin/env node
// Ox Alpha P3 probe (Q1-Q3 in tibo-watch-OxAlpha/CODEX-AUTOMATION-V2.md).
//
// Q1: does the app-server push turn/thread notifications on stdout?
// Q2: what does thread/read report while a turn is active (activeFlags)?
// Q3: does turn/start accept approvalPolicy / sandbox overrides?
//
// The probe spawns `codex app-server --listen stdio://`, performs a harmless
// handshake plus read-only calls, then starts a scratch turn on the most
// recently updated LOCAL thread and watches every stdout frame for 20s.
// It never sends approvals, never writes outside Codex's own state, and
// prints a machine-readable verdict at the end.

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { existsSync } from 'node:fs'

const localAppData = process.env.LOCALAPPDATA
const managed = localAppData
  ? path.join(
      localAppData,
      'TiboWatch',
      'codex-cli',
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
      'codex.exe',
    )
  : null
const executable =
  managed && existsSync(managed)
    ? managed
    : process.env.TIBO_PROBE_CODEX ?? null
if (!executable || !existsSync(executable)) {
  console.error('codex executable not found for probe')
  process.exit(2)
}

const child = spawn(
  executable,
  ['app-server', '--listen', 'stdio://'],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
)

let nextId = 1
const pending = new Map()
const notifications = []

function request(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`timeout waiting ${method}`))
    }, 10_000)
    pending.set(id, { resolve, reject, timer })
    const frame = { id, method }
    if (params) frame.params = params
    child.stdin.write(`${JSON.stringify(frame)}\n`)
  })
}

createInterface({ input: child.stdout }).on('line', (line) => {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    console.log('[unparseable]', line.slice(0, 160))
    return
  }
  if (typeof frame.id === 'number') {
    const entry = pending.get(frame.id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(frame.id)
    if (frame.error) entry.reject(new Error(frame.error.message ?? 'rpc error'))
    else entry.resolve(frame.result)
    return
  }
  // server -> client notification or request (has method, no id)
  notifications.push({
    method: frame.method,
    paramsPreview: JSON.stringify(frame.params ?? frame.result ?? {}).slice(0, 300),
  })
  console.log('[server-frame]', frame.method ?? '(no method)')
})

child.stderr.on('data', () => {})

async function main() {
  await request('initialize', {
    clientInfo: { name: 'tibo_probe', title: 'Tibo Probe', version: '0.0.0' },
  })
  child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)

  const account = await request('account/read', { refreshToken: false })
  console.log('[account]', JSON.stringify(account).slice(0, 200))

  const threads = await request('thread/list', {
    limit: 5,
    sortKey: 'updated_at',
    sortDirection: 'desc',
  })
  const candidates = (threads?.data ?? []).filter(
    (thread) => typeof thread?.id === 'string',
  )
  console.log(`[threads] ${candidates.length} candidate(s)`)

  let scratchThreadId = null
  const overridesFile = process.env.TIBO_PROBE_OVERRIDES_FILE
  const overrides = overridesFile
    ? JSON.parse(readFileSync(overridesFile, 'utf8'))
    : {}
  if (candidates.length > 0) {
    const read = await request('thread/read', {
      threadId: candidates[0].id,
      includeTurns: false,
    })
    console.log(
      '[thread/read idle]',
      JSON.stringify(read?.thread?.status ?? read).slice(0, 240),
    )
  }

  if (process.env.TIBO_PROBE_TURNS === '1') {
    // Opt-in live-turn probe. Prefers a SCRATCH thread so user history is
    // never touched; instruction is a fixed trivial reply.
    try {
      const started = await request('thread/start', {
        cwd: process.cwd(),
        ...overrides.threadStart,
      })
      scratchThreadId =
        started?.thread?.id ?? started?.id ?? started?.threadId ?? null
      console.log('[thread/start]', JSON.stringify(started).slice(0, 240))
    } catch (error) {
      console.log('[thread/start unsupported]', String(error.message))
    }
    if (!scratchThreadId && candidates.length > 0) {
      scratchThreadId = candidates[0].id
      await request('thread/resume', { threadId: scratchThreadId }).catch(
        () => {},
      )
    }
  }

  if (scratchThreadId && process.env.TIBO_PROBE_TURNS === '1') {
    console.log('[probe] starting scratch turn on', scratchThreadId)
    const overridesFile = process.env.TIBO_PROBE_OVERRIDES_FILE
    const overrides = overridesFile
      ? JSON.parse(readFileSync(overridesFile, 'utf8'))
      : {}
    try {
      const started = await request('turn/start', {
        threadId: scratchThreadId,
        input: [{ type: 'text', text: 'Reply with exactly: ok' }],
        ...overrides.turnStart,
      })
      console.log('[turn/start]', JSON.stringify(started).slice(0, 200))
    } catch (error) {
      console.log('[turn/start error]', String(error.message ?? error))
      if (/approval|sandbox|unrecognized|invalid|unknown/i.test(String(error))) {
        console.log('[Q3 hint] parameter rejection observed')
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20_000))
    const after = await request('thread/read', {
      threadId: scratchThreadId,
      includeTurns: false,
    })
    console.log(
      '[thread/read during/after]',
      JSON.stringify(after?.thread?.status ?? after).slice(0, 300),
    )
  }

  const methods = [...new Set(notifications.map((n) => n.method))]
  console.log('\n=== VERDICT ===')
  console.log(JSON.stringify({
    q1_notificationMethods: methods,
    q1_count: notifications.length,
    q3_overridesTested: process.env.TIBO_PROBE_OVERRIDES ?? '(not set)',
  }, null, 2))
}

main()
  .catch((error) => {
    console.error('[probe fatal]', error.message)
    process.exitCode = 1
  })
  .finally(() => child.kill())
