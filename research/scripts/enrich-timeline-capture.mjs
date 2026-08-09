import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const rawPath = path.resolve('research/dataset/timeline-capture.raw.jsonl')
const outputPath = path.resolve('research/dataset/timeline-sample.provisional.json')
const rangeCoveragePath = path.resolve('research/dataset/fxtwitter-range-coverage.json')
const searchCoveragePath = path.resolve('research/dataset/fxtwitter-search-coverage.json')
const userAgent = 'Tibo-Watch-Research/0.1 (+local-open-source-research)'

async function fetchPostUncached(id, expectedAuthor = null) {
  const response = await fetch(`https://api.fxtwitter.com/status/${id}`, {
    headers: { 'user-agent': userAgent },
  })
  if (!response.ok) throw new Error(`帖子 ${id} 返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.code !== 200 || !payload.tweet) throw new Error(`无法读取帖子 ${id}`)
  if (expectedAuthor && payload.tweet.author?.screen_name !== expectedAuthor) {
    throw new Error(`帖子 ${id} 作者不匹配`)
  }
  return payload.tweet
}

const postCache = new Map()
async function fetchPost(id, expectedAuthor = null) {
  if (!postCache.has(id)) postCache.set(id, fetchPostUncached(id))
  const post = await postCache.get(id)
  if (expectedAuthor && post.author?.screen_name !== expectedAuthor) {
    throw new Error(`帖子 ${id} 作者不匹配`)
  }
  return post
}

function excerpt(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 360)
}

const lines = (await readFile(rawPath, 'utf8')).split(/\r?\n/).filter(Boolean)
const captured = new Map()
for (const line of lines) {
  const record = JSON.parse(line)
  captured.set(record.id, record)
}

let existingById = new Map()
try {
  const existing = JSON.parse(await readFile(outputPath, 'utf8'))
  existingById = new Map(existing.records.map((record) => [record.postId, record]))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

async function enrichCapturedPost(capturedPost) {
  const existing = existingById.get(capturedPost.id)
  if (existing) {
    return {
      ...existing,
      parentContext:
        existing.postKind === 'reply' && !existing.parentContext
          ? {
              postId: null,
              author: existing.excerpt.match(/^@([^\s]+)/)?.[1] ?? null,
              excerpt: null,
              url: null,
              error: 'FxTwitter 未提供父帖 status id',
            }
          : existing.parentContext,
      captureEvidence: {
        capturedAt: capturedPost.capturedAt,
        source: capturedPost.source ?? 'authenticated_x_timeline',
      },
    }
  }

  const post = await fetchPost(capturedPost.id)
  if (post.author?.screen_name !== 'thsottiaux') return null
  let parent = null
  if (post.replying_to_status) {
    try {
      const parentPost = await fetchPost(post.replying_to_status)
      parent = {
        postId: parentPost.id,
        author: parentPost.author?.screen_name ?? null,
        excerpt: excerpt(parentPost.text),
        url: parentPost.url,
      }
    } catch (error) {
      parent = {
        postId: post.replying_to_status,
        author: post.replying_to ?? null,
        excerpt: null,
        url: `https://x.com/i/status/${post.replying_to_status}`,
        error: error.message,
      }
    }
  }

  return {
    schemaVersion: 1,
    postId: post.id,
    postUrl: post.url,
    author: post.author.screen_name,
    createdAt: new Date(post.created_timestamp * 1000).toISOString(),
    postKind: post.replying_to ? 'reply' : post.quote ? 'quote' : 'original',
    excerpt: excerpt(post.text),
    excerptHash: createHash('sha256').update(post.text ?? '', 'utf8').digest('hex'),
    parentContext: parent,
    quotedContext: post.quote
      ? {
          postId: post.quote.id,
          author: post.quote.author?.screen_name ?? null,
          excerpt: excerpt(post.quote.text),
          url: post.quote.url,
        }
      : null,
    label: '待复核',
    labelStatus: 'primary_context_collected',
    expectedTime: null,
    scope: '待复核',
    certainty: '待复核',
    ironyOrJoke: '待复核',
    rationale: '',
    captureEvidence: {
      capturedAt: capturedPost.capturedAt,
      source: capturedPost.source ?? 'authenticated_x_timeline',
    },
  }
}

const capturedPosts = [...captured.values()]
const records = []
let nextIndex = 0
let processed = 0
async function worker() {
  while (true) {
    const index = nextIndex
    nextIndex += 1
    if (index >= capturedPosts.length) return
    const record = await enrichCapturedPost(capturedPosts[index])
    if (record) records.push(record)
    processed += 1
    if (processed % 100 === 0 || processed === capturedPosts.length) {
      console.log(`上下文补齐进度 ${processed}/${capturedPosts.length}`)
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

const validIds = new Set(records.map(({ postId }) => postId))
const normalizedRaw = capturedPosts.filter(({ id }) => validIds.has(id))
await writeFile(rawPath, `${normalizedRaw.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8')

records.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
let completeSixMonthTimeline = false
try {
  const rangeCoverage = JSON.parse(await readFile(rangeCoveragePath, 'utf8'))
  const searchCoverage = JSON.parse(await readFile(searchCoveragePath, 'utf8'))
  const completeDates = new Set(
    searchCoverage.slices
      .filter(({ status }) => status === 'complete_api_search_slice')
      .map(({ date }) => date),
  )
  const sortedDates = [...completeDates].sort()
  const searchStart = sortedDates.at(0)
  const searchEndDate = new Date(`${sortedDates.at(-1)}T00:00:00.000Z`)
  searchEndDate.setUTCDate(searchEndDate.getUTCDate() + 1)
  const searchEnd = searchEndDate.toISOString().slice(0, 10)
  const expectedDates = []
  for (
    let date = new Date(`${searchStart}T00:00:00.000Z`);
    date < searchEndDate;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    expectedDates.push(date.toISOString().slice(0, 10))
  }
  completeSixMonthTimeline =
    rangeCoverage.complete === true &&
    rangeCoverage.rangeStart === '2026-02-09' &&
    rangeCoverage.rangeEnd === searchStart &&
    expectedDates.length === completeDates.size &&
    expectedDates.every((date) => completeDates.has(date)) &&
    records.at(-1)?.createdAt.slice(0, 10) === searchEnd
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: 'authenticated_x_timeline',
      completeSixMonthTimeline,
      records,
    },
    null,
    2,
  )}\n`,
  'utf8',
)

console.log(`已补齐 ${records.length} 条时间线样本的原帖与父帖上下文`)
