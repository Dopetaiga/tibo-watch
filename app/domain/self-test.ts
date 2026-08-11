import { createHash } from 'node:crypto'
import { evaluateRulesV1 } from '../rules/rules-v1.js'

export interface SelfTestCheck {
  id: string
  name: string
  expectedCandidate: boolean
  actualCandidate: boolean
  passed: boolean
  matchedRuleIds: string[]
}

export interface SelfTestResult {
  ok: boolean
  total: number
  passed: number
  failed: number
  durationMs: number
  ruleVersion: string
  datasetHash: string
  checks: SelfTestCheck[]
}

interface SelfTestFixture {
  id: string
  name: string
  sourcePostId: string
  excerpt: string
  parentExcerpt?: string
  expectedCandidate: boolean
}

// Five compact, runtime-safe fixtures distilled from the locally reviewed
// timeline. The research dataset itself is deliberately never imported here.
const FIXTURES: readonly SelfTestFixture[] = [
  {
    id: 'explicit-future',
    name: '明确的未来重置承诺',
    sourcePostId: '2043920132096045143',
    excerpt:
      'I am monitoring the situation and will reset as soon as we hit 4M',
    expectedCandidate: true,
  },
  {
    id: 'completed-usage-reset',
    name: '已经完成的用量重置',
    sourcePostId: '2070987512261029923',
    excerpt: 'Still did reset the usage because we can.',
    expectedCandidate: true,
  },
  {
    id: 'contextual-soon',
    name: '依赖父帖语境的模糊意向',
    sourcePostId: '2066028715012989281',
    excerpt: 'Quite soon actually',
    parentExcerpt: 'When is the next reset',
    expectedCandidate: true,
  },
  {
    id: 'negated-reset',
    name: '否定式重置说明不应入选',
    sourcePostId: '2071329580829319493',
    excerpt: 'Downgrading to plus will not reset things for you.',
    expectedCandidate: false,
  },
  {
    id: 'irrelevant-reply',
    name: '完全无关的简短回复不应入选',
    sourcePostId: '2081227843921678470',
    excerpt: 'Nice try',
    parentExcerpt: 'OpenAI might be back',
    expectedCandidate: false,
  },
]

export function runBasicSelfTest(): SelfTestResult {
  const startedAt = performance.now()
  const checks = FIXTURES.map((fixture) => {
    const input = {
      postId: `self-test-${fixture.id}`,
      excerpt: fixture.excerpt,
      parentContext: fixture.parentExcerpt
        ? { excerpt: fixture.parentExcerpt }
        : null,
      contentHash: createHash('sha256')
        .update(
          `${fixture.sourcePostId}\n${fixture.excerpt}\n${fixture.parentExcerpt ?? ''}`,
          'utf8',
        )
        .digest('hex'),
    }
    const first = evaluateRulesV1(input)
    const repeated = evaluateRulesV1(input)
    const deterministic = JSON.stringify(first) === JSON.stringify(repeated)
    return {
      id: fixture.id,
      name: fixture.name,
      expectedCandidate: fixture.expectedCandidate,
      actualCandidate: first.candidate,
      passed: first.candidate === fixture.expectedCandidate && deterministic,
      matchedRuleIds: first.matchedRuleIds,
    }
  })
  const passed = checks.filter((check) => check.passed).length
  return {
    ok: passed === checks.length,
    total: checks.length,
    passed,
    failed: checks.length - passed,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    ruleVersion: evaluateRulesV1({
      postId: 'self-test-version',
      excerpt: '',
      contentHash: '0'.repeat(64),
    }).ruleVersion,
    datasetHash:
      '686a28ce92bf19e2dbeb243ee6ac09ea2b21f9f51472ba9fb3d05055c7def378',
    checks,
  }
}
