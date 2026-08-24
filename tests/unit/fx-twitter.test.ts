import { describe, expect, it, vi } from 'vitest'
import { CustomEndpointAdapter } from '../../app/adapters/sources/custom-endpoint'
import { FxTwitterAdapter } from '../../app/adapters/sources/fx-twitter'

describe('FxTwitter source adapter', () => {
  it('keeps only Tibo originals, replies, and quotes and sends conditional headers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          results: [
            {
              type: 'status',
              id: '3',
              url: 'https://x.com/thsottiaux/status/3',
              text: 'quote',
              created_at: 'Sun Aug 09 03:00:00 +0000 2026',
              author: { screen_name: 'thsottiaux' },
              quote: { id: '2' },
            },
            {
              type: 'status',
              id: '2',
              url: 'https://x.com/thsottiaux/status/2',
              text: '@user reply',
              created_at: 'Sun Aug 09 02:00:00 +0000 2026',
              author: { screen_name: 'thsottiaux' },
              replying_to: { status_id: '1' },
            },
            {
              type: 'status',
              id: '1',
              url: 'https://x.com/thsottiaux/status/1',
              text: 'original',
              created_at: 'Sun Aug 09 01:00:00 +0000 2026',
              author: { screen_name: 'thsottiaux' },
            },
            {
              type: 'status',
              id: 'x',
              url: 'https://x.com/other/status/x',
              text: 'mixed in',
              created_at: 'Sun Aug 09 00:00:00 +0000 2026',
              author: { screen_name: 'other' },
            },
          ],
          cursor: { bottom: 'next' },
        }),
        {
          status: 200,
          headers: {
            etag: 'etag-2',
            'last-modified': 'Sun, 09 Aug 2026 03:00:00 GMT',
          },
        },
      ),
    )
    const logs: string[] = []
    const adapter = new FxTwitterAdapter({
      fetch: fetchMock,
      requestLog: async (line) => {
        logs.push(line)
      },
      now: (() => {
        let time = 1_000
        return () => (time += 10)
      })(),
    })
    const result = await adapter.fetchLatest(
      { etag: 'etag-1', lastPostId: '0' },
      new AbortController().signal,
    )
    expect(result.posts.map(({ id, kind }) => `${id}:${kind}`)).toEqual([
      '3:quote',
      '2:reply',
      '1:original',
    ])
    const request = fetchMock.mock.calls[0]
    expect((request[1]?.headers as Headers).get('if-none-match')).toBe('etag-1')
    expect(result.cursor).toMatchObject({
      etag: 'etag-2',
      lastPostId: '3',
      paginationCursor: 'next',
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).not.toContain('thsottiaux')
  })

  it('skips malformed statuses instead of failing the whole batch', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          results: [
            {
              type: 'status',
              id: '1',
              url: 'https://x.com/thsottiaux/status/1',
              text: 'valid',
              created_at: 'Sun Aug 09 01:00:00 +0000 2026',
              author: { screen_name: 'thsottiaux' },
            },
            {
              type: 'status',
              id: 'broken',
              url: 'https://x.com/thsottiaux/status/broken',
              text: 'invalid date',
              created_at: 'not-a-date',
              author: { screen_name: 'thsottiaux' },
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const adapter = new FxTwitterAdapter({ fetch: fetchMock })
    const result = await adapter.fetchLatest({}, new AbortController().signal)
    expect(result.posts.map(({ id }) => id)).toEqual(['1'])
  })

  it('allows HTTP only for local custom endpoints', () => {
    expect(
      () => new CustomEndpointAdapter({ baseUrl: 'http://example.com' }),
    ).toThrow('必须使用 HTTPS')
    expect(
      () => new CustomEndpointAdapter({ baseUrl: 'http://127.0.0.1:3000' }),
    ).not.toThrow()
  })
})
