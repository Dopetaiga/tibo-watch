import { describe, expect, it } from 'vitest'
import {
  mayStartNewResume,
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
})
