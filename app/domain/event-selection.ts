import type { Analysis, Post, ResetEvent } from './models.js'
import type { DashboardModel } from './dashboard.js'
import { evaluateRulesV1 } from '../rules/rules-v1.js'

export function evaluatePost(post: Post): boolean {
  return evaluateRulesV1({
    postId: post.postId,
    excerpt: post.text,
    contentHash: post.contentHash,
  }).candidate
}

export function selectInitialReviewPosts(
  posts: Post[],
  now = Date.now(),
): Post[] {
  const cutoff = now - 7 * 24 * 60 * 60 * 1000
  return [...posts]
    .filter((post) => Date.parse(post.postedAt) >= cutoff)
    .filter((post) => evaluatePost(post))
    .sort((left, right) => right.postedAt.localeCompare(left.postedAt))
}

export function deduplicateEventsByPost(events: ResetEvent[]): ResetEvent[] {
  const selected = new Map<string, ResetEvent>()
  for (const event of events) {
    const existing = selected.get(event.postId)
    const eventIsAi = event.source === 'monitoring-pipeline'
    const existingIsAi = existing?.source === 'monitoring-pipeline'
    if (
      !existing ||
      (eventIsAi && !existingIsAi) ||
      (eventIsAi === existingIsAi && event.createdAt > existing.createdAt)
    )
      selected.set(event.postId, event)
  }
  return [...selected.values()]
}

export function selectLatestExpectedEvent(
  events: ResetEvent[],
  posts: Post[],
  now?: number,
): ResetEvent | undefined {
  const postedAtByPost = new Map(
    posts.map((post) => [post.postId, post.postedAt]),
  )
  return currentExpectedEvents(events, posts, now).sort((left, right) => {
    const postedAtOrder = (
      postedAtByPost.get(right.postId) ?? ''
    ).localeCompare(postedAtByPost.get(left.postId) ?? '')
    return postedAtOrder || right.createdAt.localeCompare(left.createdAt)
  })[0]
}

/**
 * A confirmed reset closes every prediction published at or before it. This
 * makes the dashboard return immediately to the confirmed-reset + 7 day
 * baseline instead of continuing to display a promise that was just fulfilled.
 */
export function currentExpectedEvents(
  events: ResetEvent[],
  posts: Post[],
  now?: number,
): ResetEvent[] {
  const postedAtByPost = new Map(
    posts.map((post) => [post.postId, post.postedAt]),
  )
  const latestConfirmedAt = events
    .filter(
      (event) => event.status === 'confirmed' && event.resetKind !== 'banked',
    )
    .map(
      (event) =>
        event.confirmedAt ??
        postedAtByPost.get(event.postId) ??
        event.createdAt,
    )
    .filter((value) => !Number.isNaN(Date.parse(value)))
    .sort((left, right) => right.localeCompare(left))[0]

  return events.filter((event) => {
    if (event.status !== 'expected' || !event.expectedStart) return false
    if (
      now !== undefined &&
      event.expectedEnd &&
      Date.parse(event.expectedEnd) < now
    )
      return false
    if (!latestConfirmedAt) return true
    const signalPostedAt = postedAtByPost.get(event.postId) ?? event.createdAt
    return Date.parse(signalPostedAt) > Date.parse(latestConfirmedAt)
  })
}

export function prediction(
  events: ResetEvent[],
  posts: Post[],
  hours: number,
): string | null {
  const now = Date.now()
  const limit = now + hours * 60 * 60_000
  const upcoming = currentExpectedEvents(events, posts, now)
    .filter(
      (event) =>
        event.expectedStart && Date.parse(event.expectedStart) <= limit,
    )
    .sort(
      (left, right) =>
        Date.parse(left.expectedStart ?? '') -
        Date.parse(right.expectedStart ?? ''),
    )[0]
  return upcoming ? upcoming.titleZh : null
}

export function buildResetChains(
  events: ResetEvent[],
  posts: Post[],
): DashboardModel['resetChains'] {
  const postsById = new Map(posts.map((post) => [post.postId, post]))
  const ordered = events
    .map((event) => ({ event, post: postsById.get(event.postId) }))
    .filter((item): item is { event: ResetEvent; post: Post } =>
      Boolean(item.post),
    )
    .sort((left, right) =>
      left.post.postedAt.localeCompare(right.post.postedAt),
    )
  const chains: DashboardModel['resetChains'] = []
  const open = new Map<ResetEvent['resetKind'], (typeof chains)[number]>()
  const sevenDays = 7 * 86_400_000

  for (const { event, post } of ordered) {
    let chain = open.get(event.resetKind)
    if (
      chain &&
      Date.parse(post.postedAt) - Date.parse(chain.startedAt) > sevenDays
    ) {
      open.delete(event.resetKind)
      chain = undefined
    }
    if (!chain) {
      chain = {
        id: `${event.resetKind}--${post.postId}`,
        kind: event.resetKind,
        status: 'tracking',
        startedAt: post.postedAt,
        completedAt: null,
        items: [],
      }
      chains.push(chain)
      open.set(event.resetKind, chain)
    }
    chain.items.push({
      eventId: event.eventId,
      postId: post.postId,
      postedAt: post.postedAt,
      status:
        event.status === 'confirmed'
          ? 'confirmed'
          : event.status === 'expected'
            ? 'expected'
            : 'candidate',
      title: event.titleZh,
      text: post.text,
      sourceUrl: post.url,
    })
    if (event.status === 'confirmed') {
      chain.status = 'completed'
      chain.completedAt = post.postedAt
      open.delete(event.resetKind)
    }
  }
  return chains.sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  )
}

export function latestAnalysesByPost(analyses: Analysis[]): Map<string, Analysis> {
  const selected = new Map<string, Analysis>()
  for (const analysis of analyses) {
    const existing = selected.get(analysis.postId)
    if (!existing || analysis.createdAt > existing.createdAt)
      selected.set(analysis.postId, analysis)
  }
  return selected
}
