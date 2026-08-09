import { describe, expect, it } from 'vitest'
import {
  evaluateRulesV1,
  RULES_V1,
  RULES_V1_SCHEMA_VERSION,
  RULES_V1_TEST_SET_HASH,
  RULES_V1_VERSION,
} from '../../app/rules/rules-v1'

describe('rules-v1', () => {
  it('has frozen identity and one positive plus counterexample per rule', () => {
    expect(RULES_V1_VERSION).toBe('rules-v1.0.0')
    expect(RULES_V1_SCHEMA_VERSION).toBe(1)
    expect(RULES_V1_TEST_SET_HASH).toMatch(/^[a-f0-9]{64}$/)
    expect(
      RULES_V1.every((rule) => rule.positiveExampleId && rule.counterExampleId),
    ).toBe(true)
  })

  it('is deterministic for identical normalized input', () => {
    const post = {
      postId: 'example',
      excerpt: 'We will reset Codex usage limits tomorrow.',
      contentHash: 'abc123',
    }
    expect(evaluateRulesV1(post)).toEqual(evaluateRulesV1(post))
  })

  it('keeps explanatory reset language out of the candidate set', () => {
    const result = evaluateRulesV1({
      postId: 'counterexample',
      excerpt:
        'New poster shows how resets of the Codex usage limits affect our systems.',
      contentHash: 'counterexample-hash',
    })
    expect(result.candidate).toBe(false)
  })
})
