import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const datasetPath = path.resolve(
  'research/dataset/reset-leads.provisional.json',
)
const reportPath = path.resolve('research/reports/provisional-dataset.md')
const raw = await readFile(datasetPath, 'utf8')
const dataset = JSON.parse(raw)
const ids = new Set()
const kinds = new Map()
const labels = new Map()

if (dataset.status !== 'provisional_positive_leads_only') {
  throw new Error(`数据集状态异常：${dataset.status}`)
}
if (!Array.isArray(dataset.records) || dataset.records.length === 0) {
  throw new Error('候选数据集为空')
}

for (const record of dataset.records) {
  if (record.author !== 'thsottiaux')
    throw new Error(`${record.postId} 作者异常`)
  if (ids.has(record.postId)) throw new Error(`重复帖子：${record.postId}`)
  if (record.postUrl !== `https://x.com/thsottiaux/status/${record.postId}`) {
    throw new Error(`${record.postId} 原帖链接异常`)
  }
  if (!['original', 'reply', 'quote'].includes(record.postKind)) {
    throw new Error(`${record.postId} 帖子类型异常`)
  }
  if (!['已完成', '明确未来'].includes(record.label)) {
    throw new Error(`${record.postId} 临时标签异常`)
  }
  if (record.labelStatus !== 'provisional_secondary_lead') {
    throw new Error(`${record.postId} 未保持临时状态`)
  }
  if (!record.verification?.primaryLinkChecked) {
    throw new Error(`${record.postId} 未核验一手链接`)
  }
  ids.add(record.postId)
  kinds.set(record.postKind, (kinds.get(record.postKind) ?? 0) + 1)
  labels.set(record.label, (labels.get(record.label) ?? 0) + 1)
}

const hash = createHash('sha256').update(raw, 'utf8').digest('hex')
const rows = (mapping) =>
  [...mapping.entries()]
    .map(([name, count]) => `| ${name} | ${count} |`)
    .join('\n')

const report = `# 临时候选数据集报告

> 此报告只证明正样本线索已回溯到公开 X 原帖，不证明最近六个月时间线完整，也不能用于冻结 rules-v1。

- 生成时间：${dataset.generatedAt}
- 截止起点：${dataset.cutoff}
- 记录数：${dataset.records.length}
- SHA-256：\`${hash}\`
- 状态：\`${dataset.status}\`

## 帖子类型

| 类型 | 数量 |
|---|---:|
${rows(kinds)}

## 临时标签

| 标签 | 数量 |
|---|---:|
${rows(labels)}

## 尚缺验收证据

- 已登录 X 时间线中的最近六个月原创帖、回复和引用帖全集。
- 纯转推排除证据。
- 人工复核后的正样本、困难负样本、近似措辞反例和父帖语境。
- 冻结测试集、规则、混淆矩阵、precision、recall、误报和漏报列表。
`

await writeFile(reportPath, report, 'utf8')
console.log(
  `临时候选数据集验证通过：records=${dataset.records.length} sha256=${hash}`,
)
