import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const inputPath = path.resolve('research/dataset/reset-leads.provisional.json')
const outputPath = path.resolve('research/dataset/reset-leads.reviewed.json')
const input = JSON.parse(await readFile(inputPath, 'utf8'))

const completed = new Set([
  '2030474136024400173',
  '2031605592352313567',
  '2037346989244096581',
  '2044943514832871564',
  '2048997818673537399',
  '2055707616605835333',
  '2058280452851638313',
  '2061106703446450392',
  '2062329981548802523',
  '2067399435009622521',
  '2071381664853319742',
  '2076418567143408112',
  '2076735790567338203',
  '2077114635308986427',
  '2078320950488297917',
  '2081096447718723984',
  '2081940052154933696',
  '2082317452755751098',
  '2083395449814229287',
  '2086188036493344823',
])

const explicitFuture = new Set([
  '2028649088594436225',
  '2029308599835738218',
  '2031216405266481489',
  '2039248564967424483',
  '2041655710346572085',
  '2042299371602264319',
  '2046367145588916687',
  '2070653282440405046',
  '2071740419030053227',
  '2075330198887940337',
  '2075641131002700120',
  '2075820987833274448',
  '2077607697487188198',
  '2079609157934886975',
])

const vagueIntent = new Set(['2081899343091843463'])

const timeExpressions = {
  '2028649088594436225': 'will reset; no exact time',
  '2029308599835738218': 'are resetting; no exact time',
  '2031216405266481489': 'in a bit',
  '2039248564967424483': 'decision made; no exact time',
  '2041655710346572085': 'current reset plus each additional 1M users',
  '2042299371602264319': 'resetting again; no exact time',
  '2046367145588916687': 'incoming; no exact time',
  '2070653282440405046': 'in the next few hours',
  '2071740419030053227': 'in the next hour',
  '2075330198887940337': 'propagating in the next hour',
  '2075641131002700120': 'another one later in the day',
  '2075820987833274448': 'over the next 30 minutes',
  '2077607697487188198': 'in a few minutes',
  '2079609157934886975': 'in the next hour',
  '2081899343091843463': 'in a few hours when back at the laptop',
}

function scopeFor(text) {
  const normalized = text.toLowerCase()
  if (normalized.includes('chatgpt work') && normalized.includes('codex')) {
    return 'Codex、ChatGPT Work'
  }
  if (normalized.includes('plus') && normalized.includes('pro')) return 'Plus、Pro'
  if (normalized.includes('all paid')) return 'Codex 全部付费方案'
  if (normalized.includes('all plans')) return 'Codex 全部方案'
  if (normalized.includes('all codex') || normalized.includes("everyone's codex")) {
    return 'Codex 全部用户'
  }
  return 'Codex（具体方案未知）'
}

const records = input.records.map((record) => {
  let label
  if (completed.has(record.postId)) label = '已完成'
  else if (explicitFuture.has(record.postId)) label = '明确未来'
  else if (vagueIntent.has(record.postId)) label = '模糊意向'
  else throw new Error(`候选帖子尚未复核：${record.postId}`)

  return {
    ...record,
    label,
    labelStatus: 'reviewed_primary',
    expectedTime: {
      originalExpression: timeExpressions[record.postId] ?? null,
      normalizedWindow: record.expectedTime,
    },
    scope: scopeFor(record.excerpt),
    certainty: label === '模糊意向' ? '中' : '高',
    ironyOrJoke: ['2048997818673537399', '2081899343091843463', '2083395449814229287'].includes(
      record.postId,
    ),
    rationale:
      label === '已完成'
        ? '原帖使用 have reset、reset button pressed、added 等完成性表达。'
        : label === '明确未来'
          ? '原帖明确承诺或宣告正在传播的重置，并使用 will、incoming、lands、should land 等未来表达。'
          : '原帖表达想重置并给出回到电脑后的模糊时间，但尚未明确承诺执行。',
  }
})

const canonical = JSON.stringify(records)
const testSetHash = createHash('sha256').update(canonical, 'utf8').digest('hex')
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      completeSixMonthTimeline: false,
      status: 'reviewed_positive_samples_incomplete_timeline',
      testSetHash,
      records,
    },
    null,
    2,
  )}\n`,
  'utf8',
)

const counts = Object.groupBy(records, ({ label }) => label)
console.log(
  `已复核 ${records.length} 条候选：已完成=${counts['已完成']?.length ?? 0} 明确未来=${counts['明确未来']?.length ?? 0} 模糊意向=${counts['模糊意向']?.length ?? 0} sha256=${testSetHash}`,
)
