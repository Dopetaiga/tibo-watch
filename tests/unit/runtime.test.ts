import { describe, expect, it } from 'vitest'
import { NO_RELIABLE_PREDICTION } from '../../app/domain/runtime'

describe('runtime baseline', () => {
  it('does not invent a prediction when there is no signal', () => {
    expect(NO_RELIABLE_PREDICTION).toBe('暂无可靠预测')
  })
})
