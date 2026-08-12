import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const appData = process.env.APPDATA
if (!appData) throw new Error('APPDATA is unavailable')
const dataRoot = process.argv[2] ?? path.join(appData, 'tibo-watch', 'data')
const outputRoot = path.resolve('research/reports/local-materials')
const reviewedPath = path.resolve('research/dataset/reset-leads.reviewed.json')

async function records(collection) {
  const directory = path.join(dataRoot, collection)
  try {
    const files = (await readdir(directory)).filter((name) =>
      name.endsWith('.json'),
    )
    return Promise.all(
      files.map(async (name) =>
        JSON.parse(await readFile(path.join(directory, name), 'utf8')),
      ),
    )
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

function kind(text) {
  if (/\bbanked?\s+reset|reset\s+(?:into\s+)?(?:the\s+)?bank\b/i.test(text))
    return 'banked'
  if (/\bcompensat(?:e|ion|ory)\b/i.test(text)) return 'compensation'
  return 'forced'
}

function stage(label) {
  if (/已完成/.test(label)) return 'confirmed'
  if (/明确未来/.test(label)) return 'expected'
  return 'candidate'
}

function buildChains(items) {
  const chains = []
  const open = new Map()
  const sevenDays = 7 * 86_400_000
  for (const item of [...items].sort((a, b) =>
    a.postedAt.localeCompare(b.postedAt),
  )) {
    let chain = open.get(item.kind)
    if (
      chain &&
      Date.parse(item.postedAt) - Date.parse(chain.startedAt) > sevenDays
    ) {
      open.delete(item.kind)
      chain = undefined
    }
    if (!chain) {
      chain = {
        chainId: `${item.kind}--${item.postId}`,
        kind: item.kind,
        status: 'tracking',
        startedAt: item.postedAt,
        completedAt: null,
        messages: [],
      }
      chains.push(chain)
      open.set(item.kind, chain)
    }
    chain.messages.push(item)
    if (item.stage === 'confirmed') {
      chain.status = 'completed'
      chain.completedAt = item.postedAt
      open.delete(item.kind)
    }
  }
  return chains
}

function compactAnalysis(analysis) {
  return {
    relevance: analysis.relevance,
    eventType: analysis.eventType,
    scope: analysis.scope,
    expectedWindow: analysis.expectedWindow,
    confidence: analysis.confidence,
    translationZh: analysis.translationZh,
    summaryZh: analysis.summaryZh,
    evidence: analysis.evidence,
    uncertainties: analysis.uncertainties,
    sourceUrl: analysis.sourceUrl,
  }
}

const [posts, analyses, events, reviewed] = await Promise.all([
  records('posts'),
  records('analyses'),
  records('events'),
  readFile(reviewedPath, 'utf8').then(JSON.parse),
])
const postsById = new Map(posts.map((post) => [post.postId, post]))
const aiEvents = new Map(
  events
    .filter((event) => event.source === 'monitoring-pipeline')
    .map((event) => [event.postId, event]),
)
const localItems = [...aiEvents.values()]
  .map((event) => {
    const post = postsById.get(event.postId)
    if (!post) return null
    return {
      postId: post.postId,
      postedAt: post.postedAt,
      url: post.url,
      text: post.text,
      kind: event.resetKind,
      stage: event.status,
      expectedStart: event.expectedStart,
      expectedEnd: event.expectedEnd,
      source: 'local-app-data',
    }
  })
  .filter(Boolean)
const reviewedItems = reviewed.records.map((record) => ({
  postId: record.postId,
  postedAt: record.createdAt,
  url: record.postUrl,
  text: record.excerpt,
  kind: kind(record.excerpt),
  stage: stage(record.label),
  expectedStart: record.expectedTime?.normalizedWindow?.start ?? null,
  expectedEnd: record.expectedTime?.normalizedWindow?.end ?? null,
  source: 'reviewed-research-dataset',
}))
const unique = new Map(
  [...reviewedItems, ...localItems].map((item) => [item.postId, item]),
)
const chains = buildChains([...unique.values()])

const responseSizes = analyses.map((analysis) => {
  const post = postsById.get(analysis.postId)
  const request = post
    ? {
        postId: post.postId,
        postUrl: post.url,
        postedAt: post.postedAt,
        text: post.text,
        parentText: null,
        quotedText: null,
        ruleVersion: analysis.ruleVersion,
        matchedRuleIds: [],
      }
    : null
  const inputChars = request ? JSON.stringify(request).length : null
  const outputChars = JSON.stringify(compactAnalysis(analysis)).length
  return {
    postId: analysis.postId,
    inputChars,
    outputChars,
    outputToPostRatio: post?.text.length
      ? Number((outputChars / post.text.length).toFixed(2))
      : null,
    outputToRequestRatio: inputChars
      ? Number((outputChars / inputChars).toFixed(2))
      : null,
  }
})
const audit = {
  generatedAt: new Date().toISOString(),
  note: '字符数用于离线比较，不等同供应商 token 账单；系统 Prompt 未计入单条 user input。',
  oldMaxOutputTokens: 1600,
  newMaxOutputTokens: 700,
  records: responseSizes,
  averages: {
    inputChars: Math.round(
      responseSizes.reduce((n, x) => n + (x.inputChars ?? 0), 0) /
        Math.max(responseSizes.length, 1),
    ),
    outputChars: Math.round(
      responseSizes.reduce((n, x) => n + x.outputChars, 0) /
        Math.max(responseSizes.length, 1),
    ),
  },
}

const examples = [...unique.values()]
  .filter((item) =>
    /next hour|few minutes|in a bit|tomorrow|on Monday|have reset|limits have been reset|reset button pressed/i.test(
      item.text,
    ),
  )
  .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
  .slice(0, 8)
const prompt = `# Tibo 重置预测 Prompt v2

用途：仅在固定规则命中后，对单条 Tibo 原帖判断阶段并给出中国时间预测区间。不得学习或修改触发规则。

## System Prompt

你是 Tibo 重置时间预测器。输入已经通过固定规则筛选；你不能扩大规则命中范围。判断消息是 vague_intent、explicit_future、completed 或 non_event。Tibo 的自然语言时间按 America/Los_Angeles 理解，并以 postedAt 为锚点；所有预测输出为 Asia/Shanghai、带 +08:00 的 ISO 8601 区间。explicit_future 必须同时给出 start 和 end。证据只能引用当前帖子原文。输出紧凑 JSON，不解释规则。

输出字段：eventType、resetKind(forced|compensation|banked)、expectedWindow(start,end,original)、confidence、summaryZh、evidence、uncertainties、sourceUrl。

## 时间预测先验

- next hour：postedAt 后 0 至 1 小时；few minutes：0 至 2 小时；in a bit：保守取 0 至 6 小时。
- later today、tonight、tomorrow：先计算美国太平洋时区中的自然日，再转换为中国时间，不能直接使用中国自然日。
- on Monday 等星期表达：取 postedAt 之后最近的该星期；如果发帖当天正是该星期且语义为未来，只取当天剩余时段。
- lands、propagating、should see it 是传播窗口，不自动等于 completed。
- little surprise 等暗示只有与当前帖明确重置承诺共同出现时才能预测，并降低置信度。
- 不使用“承诺帖到下一条完成帖”的平均间隔；它们可能属于两次独立重置。

## 从现有素材抽取的少量锚点样本

${examples.map((item) => `- ${item.postedAt} | ${item.stage} | ${item.kind}\n  ${item.text}\n  ${item.url}`).join('\n')}

## 使用边界

- 这些样本只用于消歧和时间预测，不得作为脱离当前原帖的事实证据。
- banked 表示预存重置权益，不等于当前周额度已经重置。
- completed 才能闭环普通或补偿重置事件链；无明确完成措辞不得猜测完成。
- 自动事件链只用于审计；未经人工确认语义连续性，不用于学习兑现时间。
`

await mkdir(outputRoot, { recursive: true })
await Promise.all([
  writeFile(
    path.join(outputRoot, 'reset-chains.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), sourceCounts: { localPosts: posts.length, localAnalyses: analyses.length, localEvents: events.length, reviewedSamples: reviewed.records.length }, chains }, null, 2)}\n`,
    'utf8',
  ),
  writeFile(
    path.join(outputRoot, 'ai-token-audit.json'),
    `${JSON.stringify(audit, null, 2)}\n`,
    'utf8',
  ),
  writeFile(
    path.join(outputRoot, 'tibo-prediction-prompt-v2.md'),
    prompt,
    'utf8',
  ),
])

console.log(
  JSON.stringify({
    dataRoot,
    posts: posts.length,
    analyses: analyses.length,
    events: events.length,
    reviewed: reviewed.records.length,
    chains: chains.length,
    outputRoot,
  }),
)
