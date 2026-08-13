import { describe, expect, it } from 'vitest'
import {
  evaluateRulesV1,
  isExplicitCompletedReset,
  RULES_V1,
  RULES_V1_SCHEMA_VERSION,
  RULES_V1_TEST_SET_HASH,
  RULES_V1_VERSION,
} from '../../app/rules/rules-v1'

describe('rules-v1', () => {
  it('has frozen identity and one positive plus counterexample per rule', () => {
    expect(RULES_V1_VERSION).toBe('rules-v1.1.0')
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

  it('classifies only explicit completed reset statements as observed facts', () => {
    expect(
      isExplicitCompletedReset(
        'We have reset usage limits for all Codex and ChatGPT Work users.',
      ),
    ).toBe(true)
    expect(
      isExplicitCompletedReset(
        'The Codex usage limits have now been reset across all paid plans.',
      ),
    ).toBe(true)
    expect(isExplicitCompletedReset('Reset button pressed, enjoy.')).toBe(true)
    expect(
      isExplicitCompletedReset(
        'Enjoy a nice reset everyone. Landing in the next hour or so, go /fast.',
      ),
    ).toBe(true)
    expect(isExplicitCompletedReset('I will reset usage limits tonight.')).toBe(
      false,
    )
    expect(isExplicitCompletedReset('We are resetting the limits again.')).toBe(
      false,
    )
    expect(
      isExplicitCompletedReset('We added a banked reset to your account.'),
    ).toBe(false)
  })

  it('recognizes the observed landing announcement without widening rule-only detection', () => {
    const observed = evaluateRulesV1({
      postId: '2087706104814023111',
      excerpt:
        'Old news, but crossed 15M. Enjoy a nice reset everyone. Landing in the next hour or so, go /fast.',
      contentHash: 'observed',
    })
    expect(observed).toMatchObject({
      candidate: true,
      aiReviewRecommended: false,
      matchedRuleIds: ['rv1-reset-dispatched-and-landing'],
    })

    const ambiguous = evaluateRulesV1({
      postId: 'ambiguous',
      excerpt: 'The reset may be propagating differently for some accounts.',
      contentHash: 'ambiguous',
    })
    expect(ambiguous).toMatchObject({
      candidate: false,
      aiReviewRecommended: true,
    })
    expect(isExplicitCompletedReset(ambiguous.reasons.join(' '))).toBe(false)
  })
})
