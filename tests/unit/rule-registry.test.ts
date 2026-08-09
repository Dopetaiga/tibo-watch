import { describe, expect, it } from 'vitest'
import { RuleRegistry } from '../../app/domain/rule-registry'

function engine(version: string) {
  return {
    version,
    schemaVersion: 1,
    evaluate: (input: string) => `${version}:${input}`,
  }
}

describe('rule registry', () => {
  it('installs and rolls back without overwriting old engines', () => {
    const registry = new RuleRegistry(engine('v1'))
    registry.install(engine('v2'))
    expect(registry.current().version).toBe('v2')
    expect(registry.previous()?.version).toBe('v1')
    expect(registry.rollback().version).toBe('v1')
    expect(registry.current().evaluate('x')).toBe('v1:x')
  })
})
