import type {
  FetchPostsResult,
  PostSourceAdapter,
  SourceCursor,
  SourcePost,
} from './types.js'
import { SourceHttpError } from './types.js'
import {
  redactedTargetCategory,
  type RequestLogSink,
  writeRequestLog,
} from './request-log.js'

interface FxStatus {
  type?: string
  id?: string
  url?: string
  text?: string
  created_at?: string
  author?: { screen_name?: string }
  replying_to?: { status_id?: string } | string | null
  replying_to_status?: string | null
  quote?: { id?: string } | null
}

interface FxPayload {
  code?: number
  results?: FxStatus[]
  cursor?: { bottom?: string | null }
}

export interface FxTwitterOptions {
  baseUrl?: string
  handle?: string
  fetch?: typeof fetch
  requestLog?: RequestLogSink
  now?: () => number
}

export class FxTwitterAdapter implements PostSourceAdapter {
  readonly id: string = 'fxtwitter'
  readonly #baseUrl: string
  readonly #handle: string
  readonly #fetch: typeof fetch
  readonly #requestLog?: RequestLogSink
  readonly #now: () => number

  constructor(options: FxTwitterOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? 'https://api.fxtwitter.com').replace(
      /\/$/,
      '',
    )
    this.#handle = options.handle ?? 'thsottiaux'
    this.#fetch = options.fetch ?? fetch
    this.#requestLog = options.requestLog
    this.#now = options.now ?? Date.now
  }

  async fetchLatest(
    cursor: SourceCursor,
    signal: AbortSignal,
  ): Promise<FetchPostsResult> {
    const url = new URL(
      `${this.#baseUrl}/2/profile/${encodeURIComponent(this.#handle)}/statuses`,
    )
    url.searchParams.set('count', '100')
    url.searchParams.set('with_replies', 'true')
    if (cursor.paginationCursor)
      url.searchParams.set('cursor', cursor.paginationCursor)
    if (cursor.lastPostId) url.searchParams.set('since_id', cursor.lastPostId)
    const headers = new Headers({ accept: 'application/json' })
    if (cursor.etag) headers.set('if-none-match', cursor.etag)
    if (cursor.lastModified)
      headers.set('if-modified-since', cursor.lastModified)
    const startedAt = this.#now()
    let status: number | 'timeout' | 'offline' | 'error' = 'error'
    let resultCount = 0
    try {
      const response = await this.#fetch(url, { headers, signal })
      status = response.status
      if (response.status === 304)
        return { posts: [], cursor, notModified: true }
      if (!response.ok) throw httpError(response)
      const payload = (await response.json()) as FxPayload
      if (payload.code !== 200 || !Array.isArray(payload.results)) {
        throw new Error('FxTwitter 返回无效数据')
      }
      const posts = payload.results
        .map((item) => normalize(item, this.#handle))
        .filter((post): post is SourcePost => post !== null)
      resultCount = posts.length
      return {
        posts: uniqueNewest(posts),
        notModified: false,
        cursor: {
          etag: response.headers.get('etag') ?? cursor.etag,
          lastModified:
            response.headers.get('last-modified') ?? cursor.lastModified,
          lastPostId: posts.at(0)?.id ?? cursor.lastPostId,
          paginationCursor: payload.cursor?.bottom ?? undefined,
        },
      }
    } catch (error) {
      if (signal.aborted) status = 'timeout'
      else if (error instanceof TypeError) status = 'offline'
      throw error
    } finally {
      if (this.#requestLog) {
        await writeRequestLog(this.#requestLog, {
          timestamp: new Date(startedAt).toISOString(),
          targetCategory: redactedTargetCategory(url.toString()),
          status,
          durationMs: Math.max(0, this.#now() - startedAt),
          resultCount,
        })
      }
    }
  }

  async testConnection(
    signal: AbortSignal,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      await this.fetchLatest({}, signal)
      return { ok: true, message: 'FxTwitter 连接正常' }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '连接失败',
      }
    }
  }
}

function normalize(status: FxStatus, handle: string): SourcePost | null {
  if (
    status.type !== 'status' ||
    !status.id ||
    !status.url ||
    !status.created_at ||
    status.author?.screen_name?.toLowerCase() !== handle.toLowerCase() ||
    /^RT\s+@/i.test(status.text ?? '')
  ) {
    return null
  }
  const parentPostId =
    typeof status.replying_to === 'object' && status.replying_to
      ? (status.replying_to.status_id ?? null)
      : (status.replying_to_status ?? null)
  return {
    id: status.id,
    url: status.url,
    author: status.author.screen_name!,
    text: status.text ?? '',
    createdAt: new Date(status.created_at).toISOString(),
    kind: parentPostId ? 'reply' : status.quote ? 'quote' : 'original',
    parentPostId,
    quotedPostId: status.quote?.id ?? null,
  }
}

function uniqueNewest(posts: SourcePost[]): SourcePost[] {
  return [...new Map(posts.map((post) => [post.id, post])).values()].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt),
  )
}

function httpError(response: Response): SourceHttpError {
  const retryAfter = response.headers.get('retry-after')
  const retryAfterMs =
    retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : null
  return new SourceHttpError(
    response.status,
    `数据源返回 HTTP ${response.status}`,
    retryAfterMs,
  )
}
