import { describe, expect, it } from 'vitest'
import {
  mayStartAutomation,
  mayStartNewResume,
  maximumAllowedUsedPercent,
  nextBudgetGate,
} from '../../app/domain/codex-budget'

describe('Codex budget start gate', () => {
  it('uses hysteresis only for new resumes', () => {
    expect(
      nextBudgetGate(
        { lowerUsedPercent: 40, upperUsedPercent: 80 },
        'allow-new-resumes',
        85,
      ),
    ).toBe('block-new-resumes')
    expect(
      nextBudgetGate(
        { lowerUsedPercent: 40, upperUsedPercent: 80 },
        'block-new-resumes',
        60,
      ),
    ).toBe('block-new-resumes')
    expect(
      mayStartNewResume(
        nextBudgetGate(
          { lowerUsedPercent: 40, upperUsedPercent: 80 },
          'block-new-resumes',
          35,
        ),
      ),
    ).toBe(true)
  })

  it('reserves the configured remaining allowance before starting work', () => {
    expect(maximumAllowedUsedPercent(20)).toBe(80)
    expect(
      mayStartAutomation(55, {
        minimumRemainingPercent: 20,
        targetSpendPercent: 20,
      }),
    ).toBe(true)
    expect(
      mayStartAutomation(65, {
        minimumRemainingPercent: 20,
        targetSpendPercent: 20,
      }),
    ).toBe(false)
    expect(
      mayStartAutomation(null, {
        minimumRemainingPercent: 20,
        targetSpendPercent: 20,
      }),
    ).toBe(false)
  })
})
