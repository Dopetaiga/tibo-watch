export interface NormalizedPost {
  postId: string
  excerpt: string
  contentHash: string
  parentContext?: { excerpt?: string | null } | null
  quotedContext?: { excerpt?: string | null } | null
}

export interface RuleResult {
  candidate: boolean
  matchedRuleIds: string[]
  reasons: string[]
  inputHash: string
  ruleVersion: string
}

export interface FrozenRule {
  id: string
  description: string
  input?: 'context'
  pattern: RegExp
  positiveExampleId: string
  counterExampleId: string
}

export const RULES_V1_VERSION = 'rules-v1.0.0'
export const RULES_V1_SCHEMA_VERSION = 1
export const RULES_V1_TEST_SET_HASH =
  '686a28ce92bf19e2dbeb243ee6ac09ea2b21f9f51472ba9fb3d05055c7def378'

export const RULES_V1: readonly FrozenRule[] = [
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
    description: '回复给出 soon，且父帖明确询问下一次 reset',
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
    description: '明确提到 limit reset 的模糊意向',
    pattern:
      /\b(?:feeling\s+like|thinking\s+about|might)\b[^.!?]{0,80}\blimit\s+reset\b/i,
    positiveExampleId: '2081899343091843463',
    counterExampleId: '2080880254722392506',
  },
  {
    id: 'rv1-contextual-still-time-reset',
    description: '回复称仍有时间，且父帖明确讨论 reset',
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

const suppressionPattern =
  /(?:should\s+really\s+stop\s+pressing|never\s+ending\s+cycle|poster[^.!?]{0,120}shows\s+how\s+resets|receive[^.!?]{0,120}ask\s+for\s+a\s+reset|might\s+also\s+have\s+reset\s+other\s+rate\s+limits)/i

export function contextualText(post: NormalizedPost): string {
  return [
    `[POST]\n${post.excerpt ?? ''}`,
    `[PARENT]\n${post.parentContext?.excerpt ?? ''}`,
    `[QUOTE]\n${post.quotedContext?.excerpt ?? ''}`,
  ].join('\n')
}

export function evaluateRulesV1(post: NormalizedPost): RuleResult {
  const context = contextualText(post)
  const matchedRuleIds = (suppressionPattern.test(post.excerpt) ? [] : RULES_V1)
    .filter(({ input, pattern }) =>
      pattern.test(input === 'context' ? context : post.excerpt),
    )
    .map(({ id }) => id)
  return {
    candidate: matchedRuleIds.length > 0,
    matchedRuleIds,
    reasons: RULES_V1.filter(({ id }) => matchedRuleIds.includes(id)).map(
      ({ description }) => description,
    ),
    inputHash: post.contentHash,
    ruleVersion: RULES_V1_VERSION,
  }
}
