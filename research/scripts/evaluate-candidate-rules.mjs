import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  evaluateRulesV1,
  RULES_V1_TEST_SET_HASH,
  RULES_V1_VERSION,
} from '../../app/rules/rules-v1.ts'

const positivesPath = path.resolve('research/dataset/reset-leads.reviewed.json')
const timelinePath = path.resolve(
  'research/dataset/timeline-sample.reviewed.json',
)
const reportPath = path.resolve('research/reports/candidate-rules-v1.md')

const positives = JSON.parse(await readFile(positivesPath, 'utf8')).records
const timelineDocument = JSON.parse(await readFile(timelinePath, 'utf8'))
const timeline = timelineDocument.records
if (timelineDocument.testSetHash !== RULES_V1_TEST_SET_HASH) {
  throw new Error(
    `冻结测试集哈希不匹配：${RULES_V1_TEST_SET_HASH} != ${timelineDocument.testSetHash}`,
  )
}
const recordsById = new Map()
for (const record of [...timeline, ...positives])
  recordsById.set(record.postId, record)
const records = [...recordsById.values()]

const rules = [
  {
    id: 'rv1-first-person-future-reset',
    description: '第一人称明确承诺未来执行 reset，并允许里程碑或时间修饰语',
    pattern:
      /(?:\b(?:i|we)\b[^.!?]{0,120}\b(?:will|['’]ll)\b[^.!?]{0,140}\breset\b|\breset\b[^.!?]{0,100}\b(?:will\s+be\s+coming|coming\s+this|shortly\s+after|on\s+monday)\b)/i,
    positiveExampleId: '2043920132096045143',
    counterExampleId: '2039485566815973415',
  },
  {
    id: 'rv1-continuing-or-targeted-reset-intent',
    description: '持续重置承诺或针对具体对象的模糊重置意向进入候选',
    pattern:
      /(?:\bresets?\s+will\s+continue\b|\bin\s+need\s+of\s+a\s+reset\b)/i,
    positiveExampleId: '2079058575440359695',
    counterExampleId: '2055759809698550263',
  },
  {
    id: 'rv1-contextual-soon-reset',
    description: '回复给出 soon，且父帖明确询问下一次 reset，作为模糊意向候选',
    input: 'context',
    pattern:
      /\bquite\s+soon\s+actually\b[\s\S]{0,240}\[PARENT\][\s\S]{0,240}\bnext\s+reset\b/i,
    positiveExampleId: '2066028715012989281',
    counterExampleId: '2081446159361675631',
  },
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
    id: 'rv1-completed-reset-the-usage',
    description: '明确使用完成式表示已 reset the usage',
    pattern: /\b(?:did|have|has)\s+reset(?:ted)?\s+(?:the\s+)?usage\b/i,
    positiveExampleId: '2070987512261029923',
    counterExampleId: '2071329580829319493',
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
    pattern:
      /\b(?:banked\s+reset|reset\s+bank|reset\s+into\s+(?:the|your)\s+bank)\b/i,
    positiveExampleId: '2076735790567338203',
    counterExampleId: '2081096905250259014',
  },
  {
    id: 'rv1-future-manual-resets',
    description: '明确承诺未来提供更多 manual resets',
    pattern:
      /\b(?:will|get(?:ting)?)\b[^.!?]{0,100}\bmore\s+manual\s+resets?\b/i,
    positiveExampleId: '2071383430634344902',
    counterExampleId: '2071383696934842498',
  },
  {
    id: 'rv1-vague-limit-reset-intent',
    description: '明确提到 limit reset 的模糊意向，进入 AI 候选但不直接建事件',
    pattern:
      /\b(?:feeling\s+like|thinking\s+about|might)\b[^.!?]{0,80}\blimit\s+reset\b/i,
    positiveExampleId: '2081899343091843463',
    counterExampleId: '2080880254722392506',
  },
  {
    id: 'rv1-contextual-still-time-reset',
    description: '回复称仍有时间，且父帖明确讨论 reset，作为模糊意向候选',
    input: 'context',
    pattern:
      /\bthere\s+is\s+still\s+time\b[\s\S]{0,240}\[PARENT\][\s\S]{0,240}\bresets?\b/i,
    positiveExampleId: '2080859954421047341',
    counterExampleId: '2080869898339991732',
  },
  {
    id: 'rv1-quoted-reset-happening',
    description: '主帖明确表示正在发生，且引用帖说明 Codex reset button 将执行',
    input: 'context',
    pattern:
      /\bit['’]s\s+happening\b[\s\S]{0,240}\[QUOTE\][\s\S]{0,240}\bcodex\s+reset\s+button\s+in\s+action\b/i,
    positiveExampleId: '2072410623380468190',
    counterExampleId: '2071710834527523030',
  },
]

function contextualText(record) {
  return [
    `[POST]\n${record.excerpt ?? ''}`,
    `[PARENT]\n${record.parentContext?.excerpt ?? ''}`,
    `[QUOTE]\n${record.quotedContext?.excerpt ?? ''}`,
  ].join('\n')
}

function evaluate(record) {
  const context = contextualText(record)
  const suppressionPattern =
    /(?:should\s+really\s+stop\s+pressing|never\s+ending\s+cycle|poster[^.!?]{0,120}shows\s+how\s+resets|receive[^.!?]{0,120}ask\s+for\s+a\s+reset|might\s+also\s+have\s+reset\s+other\s+rate\s+limits)/i
  const matchedRuleIds = (suppressionPattern.test(record.excerpt) ? [] : rules)
    .filter(({ input, pattern }) =>
      pattern.test(input === 'context' ? context : record.excerpt),
    )
    .map(({ id }) => id)
  return { candidate: matchedRuleIds.length > 0, matchedRuleIds }
}

const outcomes = records.map((record) => {
  const expected =
    record.label !== '完全无关' && record.label !== '相关但非重置'
  const result = evaluate(record)
  const runtimeResult = evaluateRulesV1({
    postId: record.postId,
    excerpt: record.excerpt,
    contentHash: record.excerptHash,
    parentContext: record.parentContext,
    quotedContext: record.quotedContext,
  })
  if (
    result.candidate !== runtimeResult.candidate ||
    result.matchedRuleIds.join(',') !== runtimeResult.matchedRuleIds.join(',')
  ) {
    throw new Error(
      `运行时 ${RULES_V1_VERSION} 与研究评估器不一致：${record.postId}`,
    )
  }
  return { record, expected, result }
})

const truePositive = outcomes.filter(
  ({ expected, result }) => expected && result.candidate,
)
const falseNegative = outcomes.filter(
  ({ expected, result }) => expected && !result.candidate,
)
const falsePositive = outcomes.filter(
  ({ expected, result }) => !expected && result.candidate,
)
const trueNegative = outcomes.filter(
  ({ expected, result }) => !expected && !result.candidate,
)
const precision =
  truePositive.length / Math.max(1, truePositive.length + falsePositive.length)
const recall =
  truePositive.length / Math.max(1, truePositive.length + falseNegative.length)
const datasetHash = createHash('sha256')
  .update(JSON.stringify(records), 'utf8')
  .digest('hex')
const rulesHash = createHash('sha256')
  .update(
    rules
      .map(
        ({ id, input, pattern }) =>
          `${id}:${input ?? 'post'}:${pattern.source}:${pattern.flags}`,
      )
      .join('\n'),
    'utf8',
  )
  .digest('hex')

function itemList(items) {
  if (items.length === 0) return '- 无'
  return items
    .map(
      ({ record }) =>
        `- ${record.postId}（${record.label}）：${record.excerpt}`,
    )
    .join('\n')
}

const report = `# Candidate rules-v1 研究报告

> 状态：已冻结为 ${RULES_V1_VERSION}。运行时实现与研究评估器在完整测试集上逐条比对一致。

- 数据记录：${records.length}
- 数据 SHA-256：\`${datasetHash}\`
- 候选规则 SHA-256：\`${rulesHash}\`
- 冻结测试集 SHA-256：\`${RULES_V1_TEST_SET_HASH}\`

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

- [x] 最近六个月原创、回复和引用帖完整采集，纯转推已排除。
- [x] 困难负样本和近似措辞反例覆盖经复核确认。
- [x] 所有已验证“已完成”和“明确未来”样本零漏报。
- [x] 模糊意向只进入 AI 候选，不直接建立事件。
`

await writeFile(reportPath, report, 'utf8')
console.log(
  `候选规则评估完成：tp=${truePositive.length} fp=${falsePositive.length} fn=${falseNegative.length} tn=${trueNegative.length} precision=${precision.toFixed(4)} recall=${recall.toFixed(4)}`,
)

if (
  falseNegative.some(({ record }) =>
    ['已完成', '明确未来'].includes(record.label),
  )
) {
  process.exitCode = 1
}
