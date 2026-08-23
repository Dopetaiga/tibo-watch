import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const isWindows = process.platform === 'win32'
const userProfile =
  process.env.USERPROFILE ||
  (process.env.HOMEDRIVE && process.env.HOMEPATH
    ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
    : process.env.APPDATA
      ? path.dirname(process.env.APPDATA)
      : null)

const executable = findCodexExecutable()
if (!executable) {
  console.error(
    '未找到可启动的 Codex CLI。请先在 Tibo Watch 中完成 Codex 扫描。',
  )
  process.exit(1)
}

console.log(`Codex CLI: ${executable}`)
console.log(`扫描时间: ${new Date().toLocaleString('zh-CN')}`)

const env = { ...process.env }
if (isWindows && !env.CODEX_HOME && userProfile) {
  env.CODEX_HOME = path.join(userProfile, '.codex')
}

const windowsScript = isWindows && /\.(?:cmd|bat)$/i.test(executable)
if (windowsScript) env.TIBO_CODEX_EXECUTABLE = executable
const child = spawn(
  windowsScript ? 'cmd.exe' : executable,
  windowsScript
    ? [
        '/d',
        '/s',
        '/c',
        'call "%TIBO_CODEX_EXECUTABLE%" app-server --listen stdio://',
      ]
    : ['app-server', '--listen', 'stdio://'],
  {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  },
)
const pending = new Map()
let requestId = 0
let stderr = ''
let stdoutBuffer = ''

child.stderr.on('data', (chunk) => {
  stderr = `${stderr}${chunk.toString()}`.slice(-8_000)
})
child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk.toString()
  const lines = stdoutBuffer.split(/\r?\n/)
  stdoutBuffer = lines.pop() ?? ''
  for (const line of lines) receive(line)
})
child.once('error', failAll)
child.once('exit', (code) => {
  failAll(
    new Error(
      `Codex App Server 已退出（code=${code ?? 'unknown'}）${stderr.trim() ? `\n${stderr.trim()}` : ''}`,
    ),
  )
})

try {
  await request('initialize', {
    clientInfo: {
      name: 'tibo_watch_scanner',
      title: 'Tibo Watch Scanner',
      version: '0.2.0',
    },
  })
  notify('initialized')
  if (process.argv.includes('--create-test-session')) {
    await createTestSession()
  } else {
    const result = await request('thread/list', {
      limit: 200,
      sortKey: 'updated_at',
      sortDirection: 'desc',
    })
    const threads = Array.isArray(result?.data) ? result.data : []
    printThreads(threads)
    printLatestResumeAudit()
  }
} catch (error) {
  console.error(`\n扫描失败: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
} finally {
  child.kill()
}

function request(method, params) {
  const id = ++requestId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`请求超时：${method}`))
    }, 45_000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, 'utf8')
  })
}

function notify(method, params) {
  child.stdin.write(
    `${JSON.stringify({ method, ...(params ? { params } : {}) })}\n`,
  )
}

function receive(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (typeof message.id !== 'number') return
  const entry = pending.get(message.id)
  if (!entry) return
  globalThis.clearTimeout(entry.timer)
  pending.delete(message.id)
  if (message.error)
    entry.reject(new Error(message.error.message ?? '未知 RPC 错误'))
  else entry.resolve(message.result)
}

function failAll(error) {
  for (const entry of pending.values()) {
    globalThis.clearTimeout(entry.timer)
    entry.reject(error)
  }
  pending.clear()
}

async function createTestSession() {
  const started = await request('thread/start', {
    cwd: process.cwd(),
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: false,
    threadSource: 'tibo-watch-test',
  })
  const threadId = started?.thread?.id
  if (!threadId) throw new Error('Codex 未返回测试任务 ID')
  console.log(`\n测试任务已创建: ${threadId}`)

  const turn = await request('turn/start', {
    threadId,
    input: [
      {
        type: 'text',
        text: '这是 Tibo Watch 专用恢复测试任务。不要调用工具，不要读取或修改文件。本轮只回复“测试会话已就绪”。后续收到恢复提示时，只回复“恢复测试成功”及本轮序号。',
      },
    ],
  })
  console.log(`初始化 turn: ${turn?.turn?.id ?? '(未知)'}`)

  const deadline = Date.now() + 3 * 60_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 1_000))
    const read = await request('thread/read', {
      threadId,
      includeTurns: false,
    })
    if (read?.thread?.status?.type !== 'active') {
      console.log('测试任务初始化完成，writer 已释放。')
      console.log(`请在 Tibo Watch 中选择任务 ID: ${threadId}`)
      return
    }
  }
  throw new Error(`测试任务初始化超时：${threadId}`)
}

function findCodexExecutable() {
  const candidates = [
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        'TiboWatch',
        'codex-cli',
        'node_modules',
        '@openai',
        'codex-win32-x64',
        'vendor',
        'x86_64-pc-windows-msvc',
        'bin',
        'codex.exe',
      ),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'codex.cmd'),
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function printThreads(threads) {
  const normalized = threads.map((thread) => ({
    状态: thread?.status?.type ?? 'unknown',
    更新时间: formatTimestamp(thread?.updatedAt),
    名称: thread?.name || '(未命名)',
    工作目录: thread?.cwd || '(未知)',
    ID: thread?.id || '(未知)',
  }))
  const active = normalized.filter((thread) => thread.状态 === 'active')

  console.log(`\n运行中任务: ${active.length}`)
  if (active.length) console.table(active)
  else console.log('当前没有 active 任务。')

  console.log(
    `\n最近任务（${Math.min(15, normalized.length)}/${normalized.length}）`,
  )
  console.table(normalized.slice(0, 15))
}

function printLatestResumeAudit() {
  if (!process.env.APPDATA) return
  const indexPath = path.join(
    process.env.APPDATA,
    'tibo-watch',
    'data',
    'indexes',
    'codex-resumes.jsonl',
  )
  if (!existsSync(indexPath)) {
    console.log('\nTibo Watch 恢复审计: 暂无记录')
    return
  }
  const lines = readFileSync(indexPath, 'utf8').trim().split(/\r?\n/)
  const latest = lines.at(-1)
  console.log(`\nTibo Watch 最新恢复审计:\n${latest || '暂无记录'}`)
}

function formatTimestamp(value) {
  if (typeof value !== 'number') return '(未知)'
  const milliseconds = value < 1_000_000_000_000 ? value * 1_000 : value
  return new Date(milliseconds).toLocaleString('zh-CN')
}
