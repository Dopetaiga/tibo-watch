import { describe, expect, it } from 'vitest'
import {
  mayStartDualWindow,
  validateAutomationSettings,
} from '../../app/domain/codex-budget'

const settings = {
  lowerUsedPercent: 40,
  upperUsedPercent: 80,
  targetSpendPercent: 20,
  minimumRemainingPercent: 20,
}

const base = {
  fiveHourUsedPercent: 30 as number | null,
  weeklyUsedPercent: 10 as number | null,
  creditsUnlimited: null as boolean | null,
  spendControlReached: null as boolean | null,
  currentGate: 'allow-new-resumes' as const,
  settings,
}

describe('mayStartDualWindow', () => {
  it('allows a healthy five-hour and weekly window', () => {
    const decision = mayStartDualWindow(base)
    expect(decision.ok).toBe(true)
    expect(decision.nextGate).toBe('allow-new-resumes')
  })

  it('blocks via the five-hour hysteresis ceiling', () => {
    const decision = mayStartDualWindow({
      ...base,
      fiveHourUsedPercent: 85,
    })
    expect(decision.ok).toBe(false)
    expect(decision.reason).toContain('5 小时窗口')
    expect(decision.nextGate).toBe('block-new-resumes')
  })

  it('blocks when the five-hour window cannot absorb target spend', () => {
    const decision = mayStartDualWindow({
      ...base,
      fiveHourUsedPercent: 75, // 75+20 > 80 ceiling
    })
    expect(decision.ok).toBe(false)
    expect(decision.reason).toContain('不足以满足单轮目标消耗')
  })

  it('weekly window acts only as a hard ceiling', () => {
    const decision = mayStartDualWindow({
      ...base,
      weeklyUsedPercent: 90,
    })
    expect(decision.ok).toBe(false)
    expect(decision.reason).toContain('周窗口达到上限')
  })

  it('honours a custom weeklyUpperUsedPercent', () => {
    const decision = mayStartDualWindow({
      ...base,
      weeklyUsedPercent: 50,
      settings: { ...settings, weeklyUpperUsedPercent: 45 },
    })
    expect(decision.ok).toBe(false)
  })

  it('credits unlimited bypasses every quota check', () => {
    const decision = mayStartDualWindow({
      ...base,
      fiveHourUsedPercent: 95,
      weeklyUsedPercent: 95,
      spendControlReached: true,
      creditsUnlimited: true,
    })
    expect(decision.ok).toBe(true)
  })

  it('spend control blocks unconditionally', () => {
    const decision = mayStartDualWindow({
      ...base,
      spendControlReached: true,
    })
    expect(decision.ok).toBe(false)
    expect(decision.reason).toContain('消费控制')
  })

  it('tolerates missing weekly window on older builds', () => {
    const decision = mayStartDualWindow({
      ...base,
      weeklyUsedPercent: null,
    })
    expect(decision.ok).toBe(true)
  })
})

describe('weeklyUpperUsedPercent validation', () => {
  const full = {
    ...base.settings,
    enabled: true,
    authorizedThreadIds: [],
    afterResetEnabled: true,
    beforePredictionEnabled: false,
    beforePredictionHours: 2,
    maximumRunsPerCycle: 1,
    action: 'resume' as const,
    accelerationPrompt: '',
    threadSettings: {},
  }

  it('accepts a value inside 0-100', () => {
    expect(() =>
      validateAutomationSettings({ ...full, weeklyUpperUsedPercent: 70 }),
    ).not.toThrow()
  })

  it('rejects out-of-range values', () => {
    expect(() =>
      validateAutomationSettings({ ...full, weeklyUpperUsedPercent: 140 }),
    ).toThrow('周窗上限')
  })
})
