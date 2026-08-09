import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const cutoff = new Date('2026-02-09T00:00:00.000Z')
const outputPath = path.resolve('research/dataset/reset-leads.provisional.json')
const secondaryTimelineUrl = 'https://codex-reset.com/api/timeline'
const userAgent = 'Tibo-Watch-Research/0.1 (+local-open-source-research)'

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': userAgent } })
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`)
  return response.json()
}

function shortExcerpt(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 360)
}

function provisionalLabel(event) {
  if (event.preview) return '明确未来'
  return '已完成'
}

const timeline = await fetchJson(secondaryTimelineUrl)
const leads = timeline.events.filter(
  ({ announced_at: announcedAt }) => new Date(announcedAt) >= cutoff,
)
const records = []

for (const [index, lead] of leads.entries()) {
  const primary = await fetchJson(
    `https://api.fxtwitter.com/thsottiaux/status/${lead.id}`,
  )
  const post = primary.tweet
  if (primary.code !== 200 || !post) throw new Error(`无法核验帖子 ${lead.id}`)
  if (post.author?.screen_name !== 'thsottiaux') {
    throw new Error(`帖子 ${lead.id} 作者不是 @thsottiaux`)
  }

  const text = post.text ?? ''
  records.push({
    schemaVersion: 1,
    postId: post.id,
    postUrl: post.url,
    author: post.author.screen_name,
    createdAt: new Date(post.created_timestamp * 1000).toISOString(),
    postKind: post.replying_to ? 'reply' : post.quote ? 'quote' : 'original',
    excerpt: shortExcerpt(text),
    excerptHash: createHash('sha256').update(text, 'utf8').digest('hex'),
    label: provisionalLabel(lead),
    labelStatus: 'provisional_secondary_lead',
    expectedTime: lead.official_window ?? null,
    scope: lead.scope ?? 'unknown',
    certainty: lead.confidence ?? 'unknown',
    parentContext: post.replying_to_status
      ? {
          statusId: post.replying_to_status,
          author: post.replying_to,
        }
      : null,
    quotedPostId: post.quote?.id ?? null,
    ironyOrJoke: 'unreviewed',
    rationale: `二级线索标记为 ${lead.type}/${lead.group}；FxTwitter 已核验 X 原帖作者、正文和时间，等待人工复核标签。`,
    verification: {
      primaryLinkChecked: true,
      primaryAdapter: 'fxtwitter-status-v2',
      secondaryLeadUrl: secondaryTimelineUrl,
      secondaryLeadType: lead.type,
      secondaryLeadGroup: lead.group,
    },
  })

  if (index < leads.length - 1) {
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
}

records.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      cutoff: cutoff.toISOString(),
      status: 'provisional_positive_leads_only',
      records,
    },
    null,
    2,
  )}\n`,
  'utf8',
)

console.log(`已核验 ${records.length} 条候选重置帖子：${outputPath}`)
