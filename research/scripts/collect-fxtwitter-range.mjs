import { execFile } from 'node:child_process'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const handle = process.env.FX_HANDLE ?? 'thsottiaux'
const rangeStart = process.env.FX_START ?? '2026-02-09'
const rangeEnd = process.env.FX_END ?? '2026-07-23'
const rawPath = path.resolve('research/dataset/timeline-capture.raw.jsonl')
const statePath = path.resolve('research/dataset/fxtwitter-range-state.json')
const coveragePath = path.resolve(
  'research/dataset/fxtwitter-range-coverage.json',
)
const execFileAsync = promisify(execFile)

function utcDay(value) {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`无效 UTC 日期：${value}`)
  }
  return date
}

async function fetchJson(url) {
  const command = [
    '$response = Invoke-WebRequest -UseBasicParsing -Uri $env:TIBO_FX_URL -TimeoutSec 120',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::Write($response.Content)',
  ].join('; ')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: 150_000,
      env: { ...process.env, TIBO_FX_URL: url },
    },
  )
  return JSON.parse(stdout)
}

const start = utcDay(rangeStart)
const end = utcDay(rangeEnd)
if (start >= end) throw new Error('FX_START 必须早于 FX_END')

const rawLines = (await readFile(rawPath, 'utf8'))
  .split(/\r?\n/)
  .filter(Boolean)
const knownIds = new Set(rawLines.map((line) => JSON.parse(line).id))
let cursor = null
let pages = 0
let added = 0
let inRangeUnique = 0
let outOfRangeResults = 0

try {
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  if (
    state.handle === handle &&
    state.rangeStart === rangeStart &&
    state.rangeEnd === rangeEnd
  ) {
    if (state.complete) {
      console.log(`范围 ${rangeStart}..${rangeEnd} 已完成，不重复请求`)
      process.exit(0)
    }
    cursor = state.cursor
    pages = state.pagesFetched ?? 0
    added = state.added ?? 0
    inRangeUnique = state.inRangeUnique ?? 0
    outOfRangeResults = state.outOfRangeResults ?? 0
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const query = `from:${handle} since:${rangeStart} until:${rangeEnd} -filter:retweets`
while (true) {
  let url = `https://api.fxtwitter.com/2/search?q=${encodeURIComponent(query)}&feed=latest&count=100`
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`
  const payload = await fetchJson(url)
  if (payload.code !== 200 || !Array.isArray(payload.results)) {
    throw new Error(`FxTwitter 返回无效载荷：code=${payload.code}`)
  }

  pages += 1
  const capturedAt = new Date().toISOString()
  const pageIds = new Set()
  for (const post of payload.results) {
    if (
      post?.type !== 'status' ||
      post.author?.screen_name?.toLowerCase() !== handle.toLowerCase()
    )
      continue
    const createdAt = new Date(post.created_at)
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt < start ||
      createdAt >= end
    ) {
      outOfRangeResults += 1
      continue
    }
    pageIds.add(post.id)
    if (knownIds.has(post.id)) continue
    await appendFile(
      rawPath,
      `${JSON.stringify({ capturedAt, id: post.id, visibleText: post.text ?? '', source: 'fxtwitter_v2_search' })}\n`,
      'utf8',
    )
    knownIds.add(post.id)
    added += 1
  }
  inRangeUnique += pageIds.size

  const nextCursor = payload.cursor?.bottom ?? null
  const complete = payload.results.length === 0 || !nextCursor
  const cursorRepeated = Boolean(nextCursor && nextCursor === cursor)
  const state = {
    schemaVersion: 1,
    handle,
    rangeStart,
    rangeEnd,
    query,
    cursor: complete || cursorRepeated ? null : nextCursor,
    pagesFetched: pages,
    added,
    inRangeUnique,
    outOfRangeResults,
    complete,
    completionReason: complete
      ? payload.results.length === 0
        ? 'empty_page'
        : 'cursor_exhausted'
      : null,
    failedReason: cursorRepeated ? 'cursor_repeated' : null,
    updatedAt: new Date().toISOString(),
  }
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  console.log(
    `page=${pages} results=${payload.results.length} inRange=${pageIds.size} added=${added}`,
  )
  if (cursorRepeated)
    throw new Error('FxTwitter 游标重复；已停止，避免重复请求')
  if (complete) {
    await writeFile(coveragePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    break
  }
  cursor = nextCursor
}
