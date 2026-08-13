import { describe, expect, it } from 'vitest'
import type { Post, ResetEvent } from '../../app/domain/models'
import {
  buildResetChains,
  deduplicateEventsByPost,
  selectLatestExpectedEvent,
  selectInitialReviewPosts,
} from '../../app/main/runtime-controller'

function post(id: string, postedAt: string, text: string): Post {
  return {
    schemaVersion: 1,
    createdAt: '2099-01-01T00:00:00.000Z',
    source: 'fixture',
    contentHash: id.padEnd(64, '0'),
    postId: id,
    url: `https://x.com/thsottiaux/status/${id}`,
    author: 'thsottiaux',
    text,
    postedAt,
    kind: 'original',
    parentPostId: null,
    quotedPostId: null,
  }
}

describe('initial AI history selection', () => {
  it('selects only rule matches from the latest seven days by post timestamp', () => {
    const now = Date.parse('2026-08-12T12:00:00.000Z')
    const result = selectInitialReviewPosts(
      [
        post(
          'new-match',
          '2026-08-12T06:00:00.000Z',
          'We will reset tomorrow.',
        ),
        post('new-unmatched', '2026-08-12T07:00:00.000Z', 'Thanks!'),
        post(
          'old-match',
          '2026-08-04T06:00:00.000Z',
          'We will reset tomorrow.',
        ),
      ],
      now,
    )

    expect(result.map(({ postId }) => postId)).toEqual(['new-match'])
  })

  it('counts only the newest analysis event for the same post', () => {
    const event = (
      eventId: string,
      postId: string,
      createdAt: string,
      source = 'monitoring-pipeline',
    ): ResetEvent => ({
      schemaVersion: 1,
      createdAt,
      source,
      contentHash: eventId.padEnd(64, '0'),
      eventId,
      postId,
      analysisVersion: eventId,
      status: 'confirmed',
      eventType: 'completed',
      resetKind: 'forced',
      scope: 'Codex',
      expectedStart: null,
      expectedEnd: null,
      confirmedAt: '2026-08-12T06:00:00.000Z',
      titleZh: '已重置',
    })
    const result = deduplicateEventsByPost([
      event('old-provider', 'same-post', '2026-08-12T06:01:00.000Z'),
      event(
        'newer-rule-candidate',
        'same-post',
        '2026-08-12T06:04:00.000Z',
        'rules-baseline',
      ),
      event('new-provider', 'same-post', '2026-08-12T06:02:00.000Z'),
      event('other-post', 'other-post', '2026-08-12T06:03:00.000Z'),
    ])

    expect(result.map(({ eventId }) => eventId).sort()).toEqual([
      'new-provider',
      'other-post',
    ])
  })

  it('selects a prediction by the newest Tibo post timestamp', () => {
    const event = (
      eventId: string,
      postId: string,
      createdAt: string,
    ): ResetEvent => ({
      schemaVersion: 1,
      createdAt,
      source: 'monitoring-pipeline',
      contentHash: eventId.padEnd(64, '0'),
      eventId,
      postId,
      analysisVersion: eventId,
      status: 'expected',
      eventType: 'explicit_future',
      resetKind: 'forced',
      scope: 'Codex',
      expectedStart: '2026-08-13T00:00:00.000Z',
      expectedEnd: null,
      confirmedAt: null,
      titleZh: eventId,
    })

    const result = selectLatestExpectedEvent(
      [
        event('post-11-processed-last', 'post-11', '2026-08-12T10:00:00.000Z'),
        event('post-12-processed-first', 'post-12', '2026-08-12T09:00:00.000Z'),
      ],
      [
        post('post-11', '2026-08-11T20:00:00.000Z', 'Reset tomorrow.'),
        post('post-12', '2026-08-12T08:00:00.000Z', 'Reset tomorrow.'),
      ],
    )

    expect(result?.eventId).toBe('post-12-processed-first')
  })

  it('clears fulfilled predictions as soon as a reset is confirmed', () => {
    const expected: ResetEvent = {
      schemaVersion: 1,
      createdAt: '2026-08-12T06:21:00.000Z',
      source: 'monitoring-pipeline',
      contentHash: 'prediction'.padEnd(64, '0'),
      eventId: 'prediction',
      postId: 'promise',
      analysisVersion: 'fixture',
      status: 'expected',
      eventType: 'explicit_future',
      resetKind: 'forced',
      scope: 'Codex',
      expectedStart: '2026-08-13T00:00:00.000Z',
      expectedEnd: '2026-08-13T02:00:00.000Z',
      confirmedAt: null,
      titleZh: '明天重置',
    }
    const confirmed: ResetEvent = {
      ...expected,
      contentHash: 'confirmed'.padEnd(64, '0'),
      eventId: 'confirmed',
      postId: 'done',
      createdAt: '2026-08-13T01:02:00.000Z',
      status: 'confirmed',
      eventType: 'completed',
      expectedStart: null,
      expectedEnd: null,
      confirmedAt: '2026-08-13T01:01:37.000Z',
      titleZh: '重置已发放',
    }

    expect(
      selectLatestExpectedEvent(
        [expected, confirmed],
        [
          post('promise', '2026-08-12T06:20:37.000Z', 'Tomorrow.'),
          post('done', '2026-08-13T01:01:37.000Z', 'Enjoy a reset.'),
        ],
      ),
    ).toBeUndefined()
  })

  it('keeps a genuinely newer prediction after the latest confirmed reset', () => {
    const makeEvent = (
      id: string,
      status: ResetEvent['status'],
      confirmedAt: string | null,
    ): ResetEvent => ({
      schemaVersion: 1,
      createdAt: confirmedAt ?? '2026-08-14T00:01:00.000Z',
      source: 'monitoring-pipeline',
      contentHash: id.padEnd(64, '0'),
      eventId: id,
      postId: id,
      analysisVersion: 'fixture',
      status,
      eventType: status === 'confirmed' ? 'completed' : 'explicit_future',
      resetKind: 'forced',
      scope: 'Codex',
      expectedStart: status === 'expected' ? '2026-08-15T00:00:00.000Z' : null,
      expectedEnd: null,
      confirmedAt,
      titleZh: id,
    })
    const confirmed = makeEvent(
      'confirmed',
      'confirmed',
      '2026-08-13T01:01:37.000Z',
    )
    const newer = makeEvent('newer', 'expected', null)

    expect(
      selectLatestExpectedEvent(
        [confirmed, newer],
        [
          post('confirmed', '2026-08-13T01:01:37.000Z', 'Done.'),
          post('newer', '2026-08-14T00:00:00.000Z', 'Another reset tomorrow.'),
        ],
      )?.eventId,
    ).toBe('newer')
  })

  it('builds and closes a rule-driven reset chain by post time', () => {
    const makeEvent = (
      eventId: string,
      postId: string,
      status: ResetEvent['status'],
      eventType: ResetEvent['eventType'],
    ): ResetEvent => ({
      schemaVersion: 1,
      createdAt: '2026-08-12T12:00:00.000Z',
      source: 'monitoring-pipeline',
      contentHash: eventId.padEnd(64, '0'),
      eventId,
      postId,
      analysisVersion: 'fixture-v1',
      status,
      eventType,
      resetKind: 'forced',
      scope: 'Codex',
      expectedStart: null,
      expectedEnd: null,
      confirmedAt: status === 'confirmed' ? '2026-08-12T08:00:00.000Z' : null,
      titleZh: eventId,
    })
    const chains = buildResetChains(
      [
        makeEvent('intent', 'intent-post', 'candidate', 'vague_intent'),
        makeEvent('promise', 'promise-post', 'expected', 'explicit_future'),
        makeEvent('done', 'done-post', 'confirmed', 'completed'),
      ],
      [
        post('intent-post', '2026-08-11T08:00:00.000Z', 'Reset incoming.'),
        post('promise-post', '2026-08-11T10:00:00.000Z', 'Reset tomorrow.'),
        post('done-post', '2026-08-12T08:00:00.000Z', 'Reset completed.'),
      ],
    )

    expect(chains).toHaveLength(1)
    expect(chains[0]).toMatchObject({
      status: 'completed',
      completedAt: '2026-08-12T08:00:00.000Z',
    })
    expect(chains[0].items.map(({ eventId }) => eventId)).toEqual([
      'intent',
      'promise',
      'done',
    ])
  })
})
