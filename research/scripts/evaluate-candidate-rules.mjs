import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const positivesPath = path.resolve('research/dataset/reset-leads.reviewed.json')
const timelinePath = path.resolve('research/dataset/timeline-sample.reviewed.json')
const reportPath = path.resolve('research/reports/candidate-rules-v1.md')

const positives = JSON.parse(await readFile(positivesPath, 'utf8')).records
const timeline = JSON.parse(await readFile(timelinePath, 'utf8')).records
const recordsById = new Map()
for (const record of [...timeline, ...positives]) recordsById.set(record.postId, record)
const records = [...recordsById.values()]

const rules = [
  {
    id: 'rv1-explicit-limit-reset',
    description: '额度名词与明确 reset 动作共同出现',
    pattern:
      /(?:\b(?:usage|rate)\s+limits?\b[^.!?]{0,160}\b(?:reset(?:s|ting)?|reseting)\b|\b(?:reset(?:s|ting)?|reseting)\b[^.!?]{0,160}\b(?:usage|rate)\s+limits?\b)/i,
    positiveExampleId: '2086188036493344823',
    counterExampleId: '2081198608293187635',
  },
  {
    id: 'rv1-usage-reset-announcement',
    description: '面向 Codex、ChatGPT Work 或付费用户明确宣布 usage reset',
    pattern:
      /(?:\b(?:codex|chatgpt\s+work|paid\s+users?|all\s+codex\s+users?)\b[^.!?]{0,160}\b(?:usage\s+)?reset\b|\b(?:usage\s+)?reset\b[^.!?]{0,160}\b(?:codex|chatgpt\s+work|paid\s+users?|all\s+codex\s+users?)\b)/i,
    positiveExampleId: '2079609157934886975',
    counterExampleId: '2080880254722392506',
  },
  {
    id: 'rv1-reset-the-limits',
    description: '在同一帖子中明确表示正在或将要 reset the limits',
    pattern: /\b(?:reset(?:s|ting)?|reseting)\s+(?:the\s+)?limits?\b/i,
    positiveExampleId: '2042299371602264319',
    counterExampleId: '2081198608293187635',
  },
  {
    id: 'rv1-reset-button',
    description: '在 Codex 语境中明确表示 reset button 已按下',
    pattern: /\breset\s+button\s+pressed\b/i,
    positiveExampleId: '2031605592352313567',
    counterExampleId: '2081227843921678470',
  },
  {
    id: 'rv1-banked-reset',
    description: '明确增加或发放 banked reset',
    pattern: /\b(?:banked\s+reset|reset\s+bank|reset\s+into\s+(?:the|your)\s+bank)\b/i,
    positiveExampleId: '2076735790567338203',
    counterExampleId: '2081096905250259014',
  },
  {
    id: 'rv1-vague-limit-reset-intent',
    description: '明确提到 limit reset 的模糊意向，进入 AI 候选但不直接建事件',
    pattern: /\b(?:feeling\s+like|thinking\s+about|might)\b[^.!?]{0,80}\blimit\s+reset\b/i,
    positiveExampleId: '2081899343091843463',
    counterExampleId: '2080880254722392506',
  },
  {
    id: 'rv1-contextual-still-time-reset',
    description: '回复称仍有时间，且父帖明确讨论 reset，作为模糊意向候选',
    pattern: /\bthere\s+is\s+still\s+time\b[\s\S]{0,240}\[PARENT\][\s\S]{0,240}\bresets?\b/i,
    positiveExampleId: '2080859954421047341',
    counterExampleId: '2080869898339991732',
  },
]

function evaluate(text) {
  const matchedRuleIds = rules.filter(({ pattern }) => pattern.test(text)).map(({ id }) => id)
  return { candidate: matchedRuleIds.length > 0, matchedRuleIds }
}

function contextualText(record) {
  return [
    `[POST]\n${record.excerpt ?? ''}`,
    `[PARENT]\n${record.parentContext?.excerpt ?? ''}`,
    `[QUOTE]\n${record.quoteContext?.excerpt ?? ''}`,
  ].join('\n')
}

const outcomes = records.map((record) => {
  const expected = record.label !== '完全无关' && record.label !== '相关但非重置'
  const result = evaluate(contextualText(record))
  return { record, expected, result }
})

const truePositive = outcomes.filter(({ expected, result }) => expected && result.candidate)
const falseNegative = outcomes.filter(({ expected, result }) => expected && !result.candidate)
const falsePositive = outcomes.filter(({ expected, result }) => !expected && result.candidate)
const trueNegative = outcomes.filter(({ expected, result }) => !expected && !result.candidate)
const precision = truePositive.length / Math.max(1, truePositive.length + falsePositive.length)
const recall = truePositive.length / Math.max(1, truePositive.length + falseNegative.length)
const datasetHash = createHash('sha256')
  .update(JSON.stringify(records), 'utf8')
  .digest('hex')
const rulesHash = createHash('sha256')
  .update(rules.map(({ id, pattern }) => `${id}:${pattern.source}:${pattern.flags}`).join('\n'), 'utf8')
  .digest('hex')

function itemList(items) {
  if (items.length === 0) return '- 无'
  return items
    .map(({ record }) => `- ${record.postId}（${record.label}）：${record.excerpt}`)
    .join('\n')
}

const report = `# Candidate rules-v1 研究报告

> 状态：实验候选，禁止进入 Electron 运行时。六个月完整时间线尚未采集，不满足冻结条件。

- 数据记录：${records.length}
- 数据 SHA-256：\`${datasetHash}\`
- 候选规则 SHA-256：\`${rulesHash}\`

## 规则与样本

${rules
  .map(
    (rule) =>
      `### ${rule.id}\n\n${rule.description}\n\n- 正样本：${rule.positiveExampleId}\n- 反例：${rule.counterExampleId}`,
  )
  .join('\n\n')}

## 混淆矩阵

| | 预测候选 | 预测非候选 |
|---|---:|---:|
| 实际候选 | ${truePositive.length} | ${falseNegative.length} |
| 实际非候选 | ${falsePositive.length} | ${trueNegative.length} |

- Precision：${precision.toFixed(4)}
- Recall：${recall.toFixed(4)}

## 误报

${itemList(falsePositive)}

## 漏报

${itemList(falseNegative)}

## 冻结门禁

- [ ] 最近六个月原创、回复和引用帖完整采集，纯转推已排除。
- [ ] 困难负样本和近似措辞反例覆盖经人工确认。
- [ ] 所有已验证“已完成”和“明确未来”样本零漏报。
- [ ] 模糊意向只进入 AI 候选，不直接建立事件。
`

await writeFile(reportPath, report, 'utf8')
console.log(
  `候选规则评估完成：tp=${truePositive.length} fp=${falsePositive.length} fn=${falseNegative.length} tn=${trueNegative.length} precision=${precision.toFixed(4)} recall=${recall.toFixed(4)}`,
)

if (falseNegative.some(({ record }) => ['已完成', '明确未来'].includes(record.label))) {
  process.exitCode = 1
}
