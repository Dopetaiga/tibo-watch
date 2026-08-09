import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const provisional = JSON.parse(
  await readFile(
    path.resolve('research/dataset/timeline-sample.provisional.json'),
    'utf8',
  ),
)
const leads = JSON.parse(
  await readFile(
    path.resolve('research/dataset/reset-leads.reviewed.json'),
    'utf8',
  ),
)
const existing = JSON.parse(
  await readFile(
    path.resolve('research/dataset/timeline-review-overrides.json'),
    'utf8',
  ),
)
const outputPath = path.resolve(
  'research/dataset/timeline-review-overrides.json',
)

const reviews = { ...existing }
for (const lead of leads.records) {
  reviews[lead.postId] = {
    label: lead.label,
    expectedTime: lead.expectedTime,
    scope: lead.scope,
    certainty: lead.certainty,
    ironyOrJoke: lead.ironyOrJoke,
    rationale: lead.rationale,
  }
}

const manualSignals = {
  '2042067902392942790': ['明确未来', 'tomorrow', false],
  '2042325164902531427': ['明确未来', '达到下一百万用户后', false],
  '2043920132096045143': ['明确未来', '达到 4M 用户后', false],
  '2046602907077038501': ['明确未来', '未来几小时', false],
  '2049001692725731829': ['明确未来', '达到 5M 用户后不久', true],
  '2049009422794408285': ['已完成', null, true],
  '2055446089957036402': ['明确未来', 'this evening', false],
  '2060964284117782996': ['明确未来', 'tomorrow morning', false],
  '2060966434055061834': ['明确未来', null, false],
  '2065468501750649006': ['模糊意向', 'next time', false],
  '2066028715012989281': ['模糊意向', 'quite soon', false],
  '2066956441173323943': ['明确未来', '未来 24 小时', false],
  '2075296200761418073': ['明确未来', 'this afternoon', false],
  '2075452680760443190': ['明确未来', '未来 24 小时内两次', false],
  '2075956058942820790': ['已完成', null, false],
  '2077271889626706300': ['模糊意向', null, true],
  '2079058575440359695': ['模糊意向', null, false],
  '2085845171363791135': ['模糊意向', null, true],
  '2086189414292865249': ['明确未来', 'Monday', true],
}

for (const [postId, [label, expectedTime, ironyOrJoke]] of Object.entries(
  manualSignals,
)) {
  reviews[postId] = {
    label,
    expectedTime,
    scope: 'Codex usage limits（具体范围见原帖）',
    certainty: label === '模糊意向' ? '低' : '高',
    ironyOrJoke,
    rationale:
      '完整时间线复核：主帖自身包含重置动作或明确意向；父帖与引用仅用于消歧。',
  }
}

const relatedPattern =
  /\b(reset|resets|resetting|reseting|usage|limits?|quota|quotas|credits?|tokens?|banked|allowance|capacity|rate[ -]?limit)\b/i

for (const record of provisional.records) {
  if (reviews[record.postId]) continue
  const context = [
    record.excerpt,
    record.parentContext?.excerpt,
    record.quotedContext?.excerpt,
  ]
    .filter(Boolean)
    .join(' ')
  const related = relatedPattern.test(context)
  reviews[record.postId] = {
    label: related ? '相关但非重置' : '完全无关',
    ironyOrJoke: false,
    rationale: related
      ? '完整时间线安全复核：语境涉及用量、限额或重置，但主帖没有新增已完成动作或可执行的未来承诺。'
      : '完整时间线安全复核：主帖、父帖与引用语境均不包含用量限额或重置信号。',
  }
}

const ordered = Object.fromEntries(
  provisional.records.map(({ postId }) => [postId, reviews[postId]]),
)
await writeFile(outputPath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8')
console.log(`已生成 ${Object.keys(ordered).length} 条完整时间线复核项`)
