export interface SourcePost {
  id: string
  url: string
  author: string
  text: string
  createdAt: string
  kind: 'original' | 'reply' | 'quote'
  parentPostId: string | null
  quotedPostId: string | null
}

export interface SourceCursor {
  etag?: string
  lastModified?: string
  lastPostId?: string
  paginationCursor?: string
}

export interface FetchPostsResult {
  posts: SourcePost[]
  cursor: SourceCursor
  notModified: boolean
}

export interface PostSourceAdapter {
  readonly id: string
  fetchLatest(
    cursor: SourceCursor,
    signal: AbortSignal,
  ): Promise<FetchPostsResult>
  testConnection(signal: AbortSignal): Promise<{ ok: boolean; message: string }>
}

export class SourceHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message)
  }
}
