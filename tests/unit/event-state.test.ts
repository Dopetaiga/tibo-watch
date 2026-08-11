import { describe, expect, it } from 'vitest'
import {
  canTransitionEvent,
  transitionEvent,
} from '../../app/domain/event-state'
import type { ResetEvent } from '../../app/domain/models'

const event: ResetEvent = {
  schemaVersion: 1,
  createdAt: '2026-08-09T00:00:00.000Z',
  source: 'test',
  contentHash: 'a'.repeat(64),
  eventId: 'event-1',
  postId: 'post-1',
  analysisVersion: 'analysis-v1',
  status: 'candidate',
  eventType: 'explicit_future',
  resetKind: 'forced',
  scope: 'Codex',
  expectedStart: null,
  expectedEnd: null,
  confirmedAt: null,
  titleZh: '测试事件',
}

describe('reset event state machine', () => {
  it('allows expected and confirmed transitions', () => {
    expect(canTransitionEvent('candidate', 'expected')).toBe(true)
    const expected = transitionEvent(
      event,
      'expected',
      '2026-08-09T01:00:00.000Z',
    )
    const confirmed = transitionEvent(
      expected,
      'confirmed',
      '2026-08-09T02:00:00.000Z',
    )
    expect(confirmed.confirmedAt).toBe('2026-08-09T02:00:00.000Z')
  })

  it('rejects transitions out of terminal states', () => {
    expect(() =>
      transitionEvent(
        { ...event, status: 'denied' },
        'confirmed',
        event.createdAt,
      ),
    ).toThrow('非法事件状态迁移')
  })
})
