export interface CodexBudgetPolicy {
  lowerUsedPercent: number
  upperUsedPercent: number
}

export interface CodexThreadAutomationSettings {
  afterResetEnabled: boolean
  beforePredictionEnabled: boolean
  beforePredictionHours: number
  targetSpendPercent: number
  minimumRemainingPercent: number
  action: 'resume' | 'accelerate'
  accelerationPrompt: string
}

export interface CodexAutomationSettings extends CodexBudgetPolicy {
  enabled: boolean
  authorizedThreadIds: string[]
  afterResetEnabled: boolean
  beforePredictionEnabled: boolean
  beforePredictionHours: number
  maximumRunsPerCycle: number
  targetSpendPercent: number
  minimumRemainingPercent: number
  action: 'resume' | 'accelerate'
  accelerationPrompt: string
  /** Upper bound for waiting on a started turn; optional additive field. */
  turnTimeoutMinutes?: number
  /** Weekly-window hard ceiling; defaults to upperUsedPercent when absent. */
  weeklyUpperUsedPercent?: number
  threadSettings: Record<string, CodexThreadAutomationSettings>
}

export function maximumAllowedUsedPercent(
  minimumRemainingPercent: number,
): number {
  if (
    !Number.isFinite(minimumRemainingPercent) ||
    minimumRemainingPercent < 0 ||
    minimumRemainingPercent > 100
  )
    throw new Error('保留额度必须位于 0–100%')
  return 100 - minimumRemainingPercent
}

export function validateAutomationSettings(
  settings: CodexAutomationSettings,
): void {
  validateBudgetPolicy(settings)
  maximumAllowedUsedPercent(settings.minimumRemainingPercent)
  if (
    !Number.isFinite(settings.beforePredictionHours) ||
    settings.beforePredictionHours < 0 ||
    settings.beforePredictionHours > 168
  )
    throw new Error('预测前触发时间必须位于 0–168 小时')
  if (
    !Number.isInteger(settings.maximumRunsPerCycle) ||
    settings.maximumRunsPerCycle < 1 ||
    settings.maximumRunsPerCycle > 50
  )
    throw new Error('每周期最多任务数必须位于 1–50')
  if (
    !Number.isFinite(settings.targetSpendPercent) ||
    settings.targetSpendPercent < 1 ||
    settings.targetSpendPercent > 100
  )
    throw new Error('单轮目标消耗必须位于 1–100%')
  if (!['resume', 'accelerate'].includes(settings.action))
    throw new Error('Codex 自动化动作无效')
  if (settings.accelerationPrompt.length > 2000)
    throw new Error('加速提示词不能超过 2000 个字符')
  if (
    settings.turnTimeoutMinutes !== undefined &&
    (!Number.isFinite(settings.turnTimeoutMinutes) ||
      !Number.isInteger(settings.turnTimeoutMinutes) ||
      settings.turnTimeoutMinutes < 5 ||
      settings.turnTimeoutMinutes > 120)
  )
    throw new Error('Turn 等待超时必须位于 5–120 分钟')
  if (
    settings.weeklyUpperUsedPercent !== undefined &&
    (!Number.isFinite(settings.weeklyUpperUsedPercent) ||
      settings.weeklyUpperUsedPercent < 0 ||
      settings.weeklyUpperUsedPercent > 100)
  )
    throw new Error('周窗上限必须位于 0–100%')
  for (const [threadId, thread] of Object.entries(settings.threadSettings)) {
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(threadId))
      throw new Error('Codex 单任务配置包含无效任务 ID')
    validateThreadAutomationSettings(thread)
  }
}

export function validateThreadAutomationSettings(
  settings: CodexThreadAutomationSettings,
): void {
  maximumAllowedUsedPercent(settings.minimumRemainingPercent)
  if (
    !Number.isFinite(settings.beforePredictionHours) ||
    settings.beforePredictionHours < 0 ||
    settings.beforePredictionHours > 168
  )
    throw new Error('预测前触发时间必须位于 0–168 小时')
  if (
    !Number.isFinite(settings.targetSpendPercent) ||
    settings.targetSpendPercent < 1 ||
    settings.targetSpendPercent > 100
  )
    throw new Error('单任务额度预留必须位于 1–100%')
  if (!['resume', 'accelerate'].includes(settings.action))
    throw new Error('Codex 单任务动作无效')
  if (settings.accelerationPrompt.length > 2000)
    throw new Error('加速提示词不能超过 2000 个字符')
}

export function mayStartAutomation(
  usedPercent: number | null,
  settings: Pick<
    CodexAutomationSettings,
    'minimumRemainingPercent' | 'targetSpendPercent'
  >,
): boolean {
  if (usedPercent === null) return false
  const ceiling = maximumAllowedUsedPercent(settings.minimumRemainingPercent)
  return (
    usedPercent < ceiling &&
    usedPercent + settings.targetSpendPercent <= ceiling
  )
}
export type BudgetGateState = 'allow-new-resumes' | 'block-new-resumes'

export function nextBudgetGate(
  policy: CodexBudgetPolicy,
  previous: BudgetGateState,
  usedPercent: number | null,
): BudgetGateState {
  validateBudgetPolicy(policy)
  if (usedPercent === null) return previous
  if (usedPercent >= policy.upperUsedPercent) return 'block-new-resumes'
  if (usedPercent <= policy.lowerUsedPercent) return 'allow-new-resumes'
  return previous
}

export function validateBudgetPolicy(policy: CodexBudgetPolicy): void {
  if (
    !Number.isFinite(policy.lowerUsedPercent) ||
    !Number.isFinite(policy.upperUsedPercent) ||
    policy.lowerUsedPercent < 0 ||
    policy.upperUsedPercent > 100 ||
    policy.lowerUsedPercent >= policy.upperUsedPercent
  )
    throw new Error('额度下限必须小于上限，且位于 0–100%')
}

// Deliberately no stop/pause/interrupt operation exists in this policy. It can
// only decide whether a new resume may start.
export function mayStartNewResume(state: BudgetGateState): boolean {
  return state === 'allow-new-resumes'
}

export interface DualWindowInput {
  /** 5h rolling window usage (legacy primary). */
  fiveHourUsedPercent: number | null
  /** Weekly window usage; null on older codex builds. */
  weeklyUsedPercent: number | null
  creditsUnlimited?: boolean | null
  spendControlReached?: boolean | null
  currentGate: BudgetGateState
  settings: Pick<
    CodexAutomationSettings,
    | 'lowerUsedPercent'
    | 'upperUsedPercent'
    | 'weeklyUpperUsedPercent'
    | 'targetSpendPercent'
    | 'minimumRemainingPercent'
  >
}

export interface DualWindowDecision {
  ok: boolean
  reason: string | null
  nextGate: BudgetGateState
}

/**
 * Window-aware start decision for the 5h+weekly era:
 *  - credits.unlimited short-circuits to allow;
 *  - spendControlReached blocks unconditionally;
 *  - the 5h window keeps the hysteresis gate AND must absorb targetSpend;
 *  - the weekly window acts only as a hard ceiling (block, never release).
 */
export function mayStartDualWindow(input: DualWindowInput): DualWindowDecision {
  const { settings } = input
  if (input.creditsUnlimited === true)
    return { ok: true, reason: null, nextGate: 'allow-new-resumes' }
  if (input.spendControlReached === true)
    return {
      ok: false,
      reason: '消费控制已触发，已阻止启动',
      nextGate: 'block-new-resumes',
    }

  const nextFiveHour = nextBudgetGate(
    settings,
    input.currentGate,
    input.fiveHourUsedPercent,
  )
  if (!mayStartNewResume(nextFiveHour))
    return {
      ok: false,
      reason: '5 小时窗口达到用户设置的上限，已阻止新的恢复任务',
      nextGate: nextFiveHour,
    }
  if (
    input.fiveHourUsedPercent !== null &&
    !mayStartAutomation(input.fiveHourUsedPercent, {
      minimumRemainingPercent: settings.minimumRemainingPercent,
      targetSpendPercent: settings.targetSpendPercent,
    })
  )
    return {
      ok: false,
      reason: `当前 5 小时窗口不足以满足单轮目标消耗（${input.fiveHourUsedPercent}%），已阻止启动`,
      nextGate: nextFiveHour,
    }

  const weeklyCeiling =
    settings.weeklyUpperUsedPercent ?? settings.upperUsedPercent
  if (
    input.weeklyUsedPercent !== null &&
    input.weeklyUsedPercent >= weeklyCeiling
  )
    return {
      ok: false,
      reason: `周窗口达到上限（${input.weeklyUsedPercent}% ≥ ${weeklyCeiling}%），已阻止启动`,
      nextGate: nextFiveHour,
    }
  return { ok: true, reason: null, nextGate: nextFiveHour }
}

export interface AutomationTrace {
  gateState: BudgetGateState
  /** Human-readable reason when the run would be blocked; null otherwise. */
  blockReason: string | null
  /** Instruction that would be injected; null means plain resume. */
  instruction: string | null
  /** For before-prediction runs: the moment the trigger would fire. */
  plannedAt: string | null
}

/**
 * Pure preview of one automation leg. Shares the exact gate predicates the
 * real runner uses but never touches a client or writes any state.
 */
export function traceAutomation(input: {
  event: {
    status: string
    expectedStart: string | null
  }
  phase: 'after-reset' | 'before-prediction'
  threadId: string
  settings: CodexAutomationSettings
  planOverride?: CodexThreadAutomationSettings
  currentGate: BudgetGateState
  usedPercent: number | null
  now?: number
}): AutomationTrace {
  const { event, phase, threadId, settings, currentGate, usedPercent } = input
  const nowMs = input.now ?? Date.now()
  const plan =
    input.planOverride ?? settings.threadSettings[threadId] ?? settings
  const base: AutomationTrace = {
    gateState: currentGate,
    blockReason: null,
    instruction: plan.action === 'accelerate' ? plan.accelerationPrompt : null,
    plannedAt: null,
  }
  if (!settings.enabled) return { ...base, blockReason: '总开关未启用' }
  if (!settings.authorizedThreadIds.includes(threadId))
    return { ...base, blockReason: '该任务未加入自动计划' }
  if (phase === 'after-reset' && !plan.afterResetEnabled)
    return { ...base, blockReason: '该任务未启用“重置后执行”' }
  if (phase === 'before-prediction') {
    if (!plan.beforePredictionEnabled)
      return { ...base, blockReason: '该任务未启用“预测前执行”' }
    if (!event.expectedStart)
      return {
        ...base,
        blockReason: '事件缺少预测开始时间',
        plannedAt: null,
      }
    const plannedAt = predictionPlannedAt(
      event.expectedStart,
      plan.beforePredictionHours,
    )
    if (plannedAt === null)
      return { ...base, blockReason: '预测时间无法解析', plannedAt: null }
    base.plannedAt = new Date(Math.max(0, plannedAt)).toISOString()
    if (isPredictionPlanExpired(plannedAt, nowMs))
      return {
        ...base,
        blockReason: '计划时刻已过，等待下次事件',
        plannedAt: null,
      }
  }
  if (event.status !== 'confirmed' && phase === 'after-reset')
    return { ...base, blockReason: '仅确认事件会触发重置后执行' }
  const projectedGate = nextBudgetGate(settings, currentGate, usedPercent)
  base.gateState = projectedGate
  if (!mayStartNewResume(projectedGate))
    return {
      ...base,
      blockReason: `当前额度达到上限（${usedPercent ?? '?'}%），将阻止启动`,
    }
  if (
    usedPercent !== null &&
    !mayStartAutomation(usedPercent, {
      minimumRemainingPercent: plan.minimumRemainingPercent,
      targetSpendPercent: plan.targetSpendPercent,
    })
  )
    return {
      ...base,
      blockReason: `额度不足以满足目标消耗（当前 ${usedPercent}%，保留线 ${plan.minimumRemainingPercent}%）`,
    }
  if (usedPercent === null && plan.action === 'accelerate')
    return { ...base, blockReason: '无法读取额度时不执行自动加速消耗' }
  return base
}
export function predictionPlannedAt(
  expectedStart: string,
  beforePredictionHours: number,
): number | null {
  const value = Date.parse(expectedStart) - beforePredictionHours * 3_600_000
  return Number.isFinite(value) ? value : null
}

export function isPredictionPlanExpired(
  plannedAt: number,
  now = Date.now(),
  graceMs = 60_000,
): boolean {
  return plannedAt < now - graceMs
}
