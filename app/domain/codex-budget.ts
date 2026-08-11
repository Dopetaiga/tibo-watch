export interface CodexBudgetPolicy {
  lowerUsedPercent: number
  upperUsedPercent: number
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
