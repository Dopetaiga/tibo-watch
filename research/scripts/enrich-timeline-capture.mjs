import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const rawPath = path.resolve('research/dataset/timeline-capture.raw.jsonl')
const outputPath = path.resolve('research/dataset/timeline-sample.provisional.json')
const userAgent = 'Tibo-Watch-Research/0.1 (+local-open-source-research)'

async function fetchPost(id, expectedAuthor = null) {
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

function excerpt(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 360)
}

const lines = (await readFile(rawPath, 'utf8')).split(/\r?\n/).filter(Boolean)
const captured = new Map()
for (const line of lines) {
  const record = JSON.parse(line)
  captured.set(record.id, record)
}

const records = []
for (const [index, capturedPost] of [...captured.values()].entries()) {
  const post = await fetchPost(capturedPost.id, 'thsottiaux')
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

  records.push({
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
      source: 'authenticated_x_timeline',
    },
  })

  if (index < captured.size - 1) {
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
}

records.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: 'authenticated_x_timeline',
      completeSixMonthTimeline: false,
      records,
    },
    null,
    2,
  )}\n`,
  'utf8',
)

console.log(`已补齐 ${records.length} 条时间线样本的原帖与父帖上下文`)
