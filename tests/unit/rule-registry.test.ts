import { describe, expect, it } from 'vitest'
import { RuleRegistry } from '../../app/domain/rule-registry'
import { compareRuleReplay } from '../../app/domain/rule-replay'

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
    registry.install(engine('v2'), () => {})
    expect(registry.current().version).toBe('v2')
    expect(registry.previous()?.version).toBe('v1')
    expect(registry.rollback().version).toBe('v1')
    expect(registry.current().evaluate('x')).toBe('v1:x')
  })

  it('keeps the built-in version active when candidate validation fails', () => {
    const registry = new RuleRegistry(engine('v1'))
    expect(() =>
      registry.install(engine('broken'), () => {
        throw new Error('invalid rule package')
      }),
    ).toThrow('invalid rule package')
    expect(registry.current().version).toBe('v1')
    expect(registry.previous()).toBeNull()
  })

  it('replays old and new rules side by side without mutating history', () => {
    const input = ['a', 'b'] as const
    const comparison = compareRuleReplay(input, engine('v1'), engine('v2'))
    expect(comparison).toEqual([
      {
        input: 'a',
        current: { version: 'v1', output: 'v1:a' },
        candidate: { version: 'v2', output: 'v2:a' },
      },
      {
        input: 'b',
        current: { version: 'v1', output: 'v1:b' },
        candidate: { version: 'v2', output: 'v2:b' },
      },
    ])
    expect(input).toEqual(['a', 'b'])
  })
})
