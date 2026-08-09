import type { ResetEvent, ResetEventStatus } from './models.js'

const transitions: Readonly<
  Record<ResetEventStatus, readonly ResetEventStatus[]>
> = {
  candidate: ['expected', 'confirmed', 'denied', 'expired'],
  expected: ['confirmed', 'denied', 'expired'],
  confirmed: [],
  denied: [],
  expired: [],
}

export function canTransitionEvent(
  from: ResetEventStatus,
  to: ResetEventStatus,
): boolean {
  return from === to || transitions[from].includes(to)
}

export function transitionEvent(
  event: ResetEvent,
  nextStatus: ResetEventStatus,
  changedAt: string,
): ResetEvent {
  if (!canTransitionEvent(event.status, nextStatus)) {
    throw new Error(`非法事件状态迁移：${event.status} -> ${nextStatus}`)
  }
  return {
    ...event,
    status: nextStatus,
    confirmedAt: nextStatus === 'confirmed' ? changedAt : event.confirmedAt,
  }
}
