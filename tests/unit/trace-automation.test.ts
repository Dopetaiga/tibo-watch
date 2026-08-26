import { describe, expect, it } from 'vitest'
import {
  traceAutomation,
  type CodexAutomationSettings,
} from '../../app/domain/codex-budget'

const baseSettings: CodexAutomationSettings = {
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
  action: 'resume',
  accelerationPrompt: '加速！',
  threadSettings: {},
}

const confirmedEvent = { status: 'confirmed', expectedStart: null }
const now = new Date('2026-08-24T12:00:00.000Z').getTime()

describe('traceAutomation', () => {
  it('passes a healthy after-reset leg with plain resume', () => {
    const trace = traceAutomation({
      event: confirmedEvent,
      phase: 'after-reset',
      threadId: 'thread-1',
      settings: baseSettings,
      currentGate: 'allow-new-resumes',
      usedPercent: 30,
      now,
    })
    expect(trace.blockReason).toBeNull()
    expect(trace.instruction).toBeNull()
    expect(trace.gateState).toBe('allow-new-resumes')
  })

  it('blocks when disabled, unauthorized, or over the ceiling', () => {
    const run = (over: Partial<CodexAutomationSettings>, used = 30) =>
      traceAutomation({
        event: confirmedEvent,
        phase: 'after-reset',
        threadId: 'thread-1',
        settings: { ...baseSettings, ...over },
        currentGate: 'allow-new-resumes',
        usedPercent: used,
        now,
      }).blockReason
    expect(run({ enabled: false })).toContain('总开关')
    expect(
      traceAutomation({
        event: confirmedEvent,
        phase: 'after-reset',
        threadId: 'thread-other',
        settings: baseSettings,
        currentGate: 'allow-new-resumes',
        usedPercent: 30,
        now,
      }).blockReason,
    ).toContain('未加入自动计划')
    expect(run({}, 85)).toContain('上限')
  })

  it('flags accelerate instruction and the null-quota guard', () => {
    const settings = {
      ...baseSettings,
      action: 'accelerate' as const,
    }
    const withQuota = traceAutomation({
      event: confirmedEvent,
      phase: 'after-reset',
      threadId: 'thread-1',
      settings,
      currentGate: 'allow-new-resumes',
      usedPercent: 30,
      now,
    })
    expect(withQuota.instruction).toBe('加速！')
    const withoutQuota = traceAutomation({
      event: confirmedEvent,
      phase: 'after-reset',
      threadId: 'thread-1',
      settings,
      currentGate: 'allow-new-resumes',
      usedPercent: null,
      now,
    })
    expect(withoutQuota.blockReason).toContain('无法读取额度')
  })

  it('allows timer jitter but blocks genuinely stale prediction plans', () => {
    const settings = {
      ...baseSettings,
      beforePredictionEnabled: true,
      beforePredictionHours: 0,
    }
    const run = (offsetMs: number) =>
      traceAutomation({
        event: {
          status: 'expected',
          expectedStart: new Date(now + offsetMs).toISOString(),
        },
        phase: 'before-prediction',
        threadId: 'thread-1',
        settings,
        currentGate: 'allow-new-resumes',
        usedPercent: 30,
        now,
      })
    expect(run(-30_000).blockReason).toBeNull()
    expect(run(-61_000).blockReason).toContain('已过')
  })
  it('computes plannedAt for before-prediction and flags stale schedules', () => {
    const expectedStart = new Date(now + 6 * 3_600_000).toISOString()
    const settings = {
      ...baseSettings,
      beforePredictionEnabled: true,
      beforePredictionHours: 2,
    }
    const fresh = traceAutomation({
      event: { status: 'expected', expectedStart },
      phase: 'before-prediction',
      threadId: 'thread-1',
      settings,
      currentGate: 'allow-new-resumes',
      usedPercent: 30,
      now,
    })
    expect(fresh.plannedAt).toBe(new Date(now + 4 * 3_600_000).toISOString())
    const stale = traceAutomation({
      event: {
        status: 'expected',
        expectedStart: new Date(now - 24 * 3_600_000).toISOString(),
      },
      phase: 'before-prediction',
      threadId: 'thread-1',
      settings,
      currentGate: 'allow-new-resumes',
      usedPercent: 30,
      now,
    })
    expect(stale.blockReason).toContain('已过')
  })
})
