import type { VersionedRuleEngine } from './rule-registry.js'

export interface ReplayComparison<Input, Output> {
  input: Input
  current: { version: string; output: Output }
  candidate: { version: string; output: Output }
}

export function compareRuleReplay<Input, Output>(
  inputs: readonly Input[],
  current: VersionedRuleEngine<Input, Output>,
  candidate: VersionedRuleEngine<Input, Output>,
): ReplayComparison<Input, Output>[] {
  return inputs.map((input) => ({
    input,
    current: { version: current.version, output: current.evaluate(input) },
    candidate: {
      version: candidate.version,
      output: candidate.evaluate(input),
    },
  }))
}
