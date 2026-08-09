import { describe, expect, it } from 'vitest'
import { isPost, recordKeys } from '../../app/domain/schemas'

describe('record schemas and idempotency keys', () => {
  it('rejects incomplete posts', () => {
    expect(isPost({ schemaVersion: 1 })).toBe(false)
  })

  it('uses post and analysis versions in stable keys', () => {
    expect(recordKeys.post({ postId: '1' })).toBe('1')
    expect(
      recordKeys.analysis({
        postId: '1',
        analysisVersion: 'rules-v1--prompt-v1--model-a',
      }),
    ).toBe('1--rules-v1--prompt-v1--model-a')
  })
})
