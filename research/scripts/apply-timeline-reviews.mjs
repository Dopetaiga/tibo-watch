import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const inputPath = path.resolve('research/dataset/timeline-sample.provisional.json')
const reviewPath = path.resolve('research/dataset/timeline-review-overrides.json')
const outputPath = path.resolve('research/dataset/timeline-sample.reviewed.json')

const input = JSON.parse(await readFile(inputPath, 'utf8'))
const reviews = JSON.parse(await readFile(reviewPath, 'utf8'))
const inputIds = new Set(input.records.map(({ postId }) => postId))

for (const reviewId of Object.keys(reviews)) {
  if (!inputIds.has(reviewId)) throw new Error(`复核项没有对应样本：${reviewId}`)
}

const records = input.records.map((record) => {
  const review = reviews[record.postId]
  if (!review) throw new Error(`样本尚未人工复核：${record.postId}`)
  return {
    ...record,
    label: review.label,
    labelStatus: 'reviewed_primary',
    expectedTime: review.expectedTime ?? null,
    scope: review.scope ?? '未知',
    certainty: review.certainty ?? (review.label === '完全无关' ? '不适用' : '高'),
    ironyOrJoke: review.ironyOrJoke,
    rationale: review.rationale,
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
      source: input.source,
      completeSixMonthTimeline: input.completeSixMonthTimeline,
      testSetHash,
      records,
    },
    null,
    2,
  )}\n`,
  'utf8',
)

console.log(`已应用 ${records.length} 条人工复核：sha256=${testSetHash}`)
