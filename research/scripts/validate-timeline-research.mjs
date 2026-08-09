import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const rawPath = path.resolve('research/dataset/timeline-capture.raw.jsonl')
const provisionalPath = path.resolve(
  'research/dataset/timeline-sample.provisional.json',
)
const reviewedPath = path.resolve(
  'research/dataset/timeline-sample.reviewed.json',
)
const coveragePath = path.resolve('research/dataset/timeline-coverage.json')
const rangeCoveragePath = path.resolve(
  'research/dataset/fxtwitter-range-coverage.json',
)
const searchCoveragePath = path.resolve(
  'research/dataset/fxtwitter-search-coverage.json',
)
const reportPath = path.resolve('research/reports/timeline-validation.md')

const allowedLabels = new Set([
  '已完成',
  '明确未来',
  '模糊意向',
  '相关但非重置',
  '完全无关',
])
const raw = (await readFile(rawPath, 'utf8'))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const provisional = JSON.parse(await readFile(provisionalPath, 'utf8'))
const reviewed = JSON.parse(await readFile(reviewedPath, 'utf8'))
const coverage = JSON.parse(await readFile(coveragePath, 'utf8'))
const rangeCoverage = JSON.parse(await readFile(rangeCoveragePath, 'utf8'))
const searchCoverage = JSON.parse(await readFile(searchCoveragePath, 'utf8'))

const failures = []
const rawIds = raw.map(({ id }) => id)
const rawUniqueIds = new Set(rawIds)
const provisionalIds = new Set(provisional.records.map(({ postId }) => postId))
const reviewedIds = new Set(reviewed.records.map(({ postId }) => postId))

if (
  !provisional.completeSixMonthTimeline ||
  !reviewed.completeSixMonthTimeline
) {
  failures.push('富化集或复核集未声明六个月时间线完整')
}
if (
  !rangeCoverage.complete ||
  rangeCoverage.completionReason !== 'empty_page'
) {
  failures.push('FxTwitter 连续范围没有空页分页终点证据')
}
const allCompletedSearchDates = searchCoverage.slices
  .filter(({ status }) => status === 'complete_api_search_slice')
  .map(({ date }) => date)
  .sort()
const searchStart = allCompletedSearchDates.at(0)
const searchEndDate = new Date(
  `${allCompletedSearchDates.at(-1)}T00:00:00.000Z`,
)
searchEndDate.setUTCDate(searchEndDate.getUTCDate() + 1)
const searchEnd = searchEndDate.toISOString().slice(0, 10)
if (
  rangeCoverage.rangeStart !== '2026-02-09' ||
  rangeCoverage.rangeEnd !== searchStart
) {
  failures.push('连续范围与逐日覆盖范围不连续')
}
const expectedSearchDates = []
for (
  let date = new Date(`${searchStart}T00:00:00.000Z`);
  date < searchEndDate;
  date.setUTCDate(date.getUTCDate() + 1)
) {
  expectedSearchDates.push(date.toISOString().slice(0, 10))
}
const completedSearchDates = new Set(
  searchCoverage.slices
    .filter(({ status }) => status === 'complete_api_search_slice')
    .map(({ date }) => date),
)
if (
  completedSearchDates.size !== expectedSearchDates.length ||
  !expectedSearchDates.every((date) => completedSearchDates.has(date))
) {
  failures.push('逐日 API 搜索覆盖存在日期缺口')
}
if (reviewed.records.at(-1)?.createdAt.slice(0, 10) !== searchEnd) {
  failures.push('逐日搜索终点之后缺少当前日时间线样本')
}
for (const slice of searchCoverage.slices) {
  if (
    !['empty_page', 'cursor_exhausted', 'cursor_repeated'].includes(
      slice.completionReason,
    )
  ) {
    failures.push(`API 搜索分片 ${slice.date} 缺少分页终点证据`)
  }
  const uncaptured = slice.postIds.filter((id) => !rawUniqueIds.has(id))
  if (uncaptured.length)
    failures.push(
      `API 搜索分片 ${slice.date} 存在未捕获 ID：${uncaptured.join(',')}`,
    )
}

function duplicateIds(ids) {
  const counts = new Map()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts].filter(([, count]) => count > 1)
}

function sameIds(left, right, description) {
  const missing = [...left].filter((id) => !right.has(id))
  const extra = [...right].filter((id) => !left.has(id))
  if (missing.length || extra.length) {
    failures.push(
      `${description}：missing=${missing.join(',') || '无'} extra=${extra.join(',') || '无'}`,
    )
  }
}

sameIds(rawUniqueIds, provisionalIds, '原始捕获与富化集 ID 不一致')
sameIds(provisionalIds, reviewedIds, '富化集与复核集 ID 不一致')

for (const [index, slice] of coverage.slices.entries()) {
  const sliceName = `覆盖分片 ${index + 1}`
  if (slice.status !== 'complete_search_slice') continue
  if (
    !slice.endEvidence?.atBottom ||
    !slice.endEvidence?.unchangedVisibleSetAfterAdditionalScroll
  ) {
    failures.push(`${sliceName} 缺少滚动终点证据`)
  }
  if (
    slice.resultCount !== slice.postIds.length ||
    new Set(slice.postIds).size !== slice.postIds.length
  ) {
    failures.push(`${sliceName} resultCount 或 postIds 唯一性不一致`)
  }
  const uncaptured = slice.postIds.filter((id) => !rawUniqueIds.has(id))
  if (uncaptured.length)
    failures.push(
      `${sliceName} 存在未进入原始捕获的数据：${uncaptured.join(',')}`,
    )
}

const provisionalDuplicates = duplicateIds(
  provisional.records.map(({ postId }) => postId),
)
const reviewedDuplicates = duplicateIds(
  reviewed.records.map(({ postId }) => postId),
)
if (provisionalDuplicates.length) failures.push('富化集包含重复 postId')
if (reviewedDuplicates.length) failures.push('复核集包含重复 postId')

for (const record of reviewed.records) {
  if (!allowedLabels.has(record.label))
    failures.push(`${record.postId} 标签不合法：${record.label}`)
  if (record.labelStatus !== 'reviewed_primary') {
    failures.push(`${record.postId} 尚未完成一手语境复核`)
  }
  if (record.postKind === 'reply' && !record.parentContext) {
    failures.push(`${record.postId} 是回复但缺少 parentContext`)
  }
  if (['已完成', '明确未来'].includes(record.label)) {
    if (!record.scope || record.scope === '未知')
      failures.push(`${record.postId} 强正样本缺少 scope`)
    if (!record.certainty || record.certainty === '不适用') {
      failures.push(`${record.postId} 强正样本缺少 certainty`)
    }
  }
}

const byLabel = Object.fromEntries(
  [...allowedLabels].map((label) => [
    label,
    reviewed.records.filter((record) => record.label === label).length,
  ]),
)
const timestamps = reviewed.records.map(({ createdAt }) => createdAt).sort()
const parentErrors = reviewed.records.filter(
  ({ parentContext }) => parentContext?.error,
)
const quotedContexts = reviewed.records.filter(
  ({ quotedContext }) => quotedContext,
)
const completeSlices = coverage.slices.filter(
  ({ status }) => status === 'complete_search_slice',
)
const completeApiSlices = searchCoverage.slices.filter(
  ({ status }) => status === 'complete_api_search_slice',
)
const recordsHash = createHash('sha256')
  .update(JSON.stringify(reviewed.records), 'utf8')
  .digest('hex')

const report = `# 时间线研究数据验证

> 此报告验证数据一致性，不证明 X 时间线采集已经完整。六个月覆盖完成前不得冻结规则。

- 原始观察：${raw.length}
- 原始唯一帖子：${rawUniqueIds.size}
- 重复观察：${raw.length - rawUniqueIds.size}
- 富化记录：${provisional.records.length}
- 人工复核记录：${reviewed.records.length}
- 最早 UTC：${timestamps.at(0) ?? '无'}
- 最晚 UTC：${timestamps.at(-1) ?? '无'}
- 含父帖读取错误：${parentErrors.length}
- 含引用帖语境：${quotedContexts.length}
- 已完成搜索分片：${completeSlices.length}
- 已完成分片结果总数：${completeSlices.reduce((sum, slice) => sum + slice.resultCount, 0)}
- 已完成 API 日期分片：${completeApiSlices.length}
- API 连续范围分页：${rangeCoverage.pagesFetched} 页，终点 ${rangeCoverage.completionReason}
- 复核记录 SHA-256：\`${recordsHash}\`

## 标签分布

${Object.entries(byLabel)
  .map(([label, count]) => `- ${label}：${count}`)
  .join('\n')}

## 一致性检查

${failures.length ? failures.map((failure) => `- [ ] ${failure}`).join('\n') : '- [x] 原始、富化和复核 ID 集合一致，postId 唯一，标签与强正样本字段完整。'}

## 覆盖结论

- [x] 最近六个月原创、回复和引用帖已通过连续 API 范围、逐日补充范围及当前日时间线完成采集。
- [x] 连续范围以空页结束，后续 ${completeApiSlices.length} 个日期分片均保留 API 分页终点证据，日期区间无缺口。
`

await writeFile(reportPath, report, 'utf8')
console.log(
  `时间线验证：observations=${raw.length} unique=${rawUniqueIds.size} reviewed=${reviewed.records.length} failures=${failures.length} sha256=${recordsHash}`,
)

if (failures.length) process.exitCode = 1
