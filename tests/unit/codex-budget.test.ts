import { describe, expect, it } from 'vitest'
import {
  mayStartAutomation,
  mayStartNewResume,
  maximumAllowedUsedPercent,
  nextBudgetGate,
  validateAutomationSettings,
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

  it('limits how many tasks one reset cycle may start', () => {
    const settings = {
      enabled: true,
      authorizedThreadIds: ['thread-1'],
      lowerUsedPercent: 40,
      upperUsedPercent: 80,
      afterResetEnabled: true,
      beforePredictionEnabled: false,
      beforePredictionHours: 2,
      maximumRunsPerCycle: 1,
      targetSpendPercent: 20,
      minimumRemainingPercent: 20,
      action: 'resume' as const,
      accelerationPrompt: '',
      threadSettings: {},
    }
    expect(() => validateAutomationSettings(settings)).not.toThrow()
    expect(() =>
      validateAutomationSettings({ ...settings, maximumRunsPerCycle: 0 }),
    ).toThrow('每周期最多任务数')
    expect(() =>
      validateAutomationSettings({
        ...settings,
        threadSettings: {
          'thread-1': {
            afterResetEnabled: true,
            beforePredictionEnabled: true,
            beforePredictionHours: 169,
            targetSpendPercent: 20,
            minimumRemainingPercent: 20,
            action: 'resume',
            accelerationPrompt: '',
          },
        },
      }),
    ).toThrow('预测前触发时间')
  })
})
