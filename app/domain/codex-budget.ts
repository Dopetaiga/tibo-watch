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
