import { describe, expect, it } from 'vitest'
import { runBasicSelfTest } from '../../app/domain/self-test'

describe('basic offline self-test', () => {
  it('passes the compact reviewed positive and hard-negative fixture set', () => {
    const result = runBasicSelfTest()

    expect(result).toMatchObject({ ok: true, total: 5, passed: 5, failed: 0 })
    expect(result.checks.map(({ actualCandidate }) => actualCandidate)).toEqual(
      [true, true, true, false, false],
    )
    expect(result.datasetHash).toMatch(/^[a-f0-9]{64}$/)
  })
})
