import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RuntimeController } from '../../app/main/runtime-controller'
import { MemoryCredentialStore } from '../../app/adapters/credentials/memory-store'

// Contract guard: locks the DashboardModel shape returned by snapshot() so
// renderer refactors (Ox Alpha P1/P2) cannot silently break the UI contract.
const temporaryDirectories: string[] = []

async function createController() {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'tibo-watch-contract-'))
  temporaryDirectories.push(dataRoot)
  return new RuntimeController(
    dataRoot,
    async () => {},
    new MemoryCredentialStore(),
  )
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('dashboard:get contract', () => {
  it('exposes the exact top-level model shape the renderer depends on', async () => {
    const controller = await createController()
    const model = await controller.snapshot()
    expect(Object.keys(model).sort()).toEqual(
      [
        'consecutiveFailures',
        'dataStatus',
        'details',
        'events',
        'health',
        'healthMessage',
        'lastCheckedAt',
        'lastInferredResetAt',
        'lastObservedResetAt',
        'baselinePreviousResetAt',
        'baselineNextResetAt',
        'latestEvidence',
        'latestSourceUrl',
        'latestSummary',
        'monitorMode',
        'pollingIntervalMinutes',
        'posts',
        'prediction24h',
        'prediction48h',
        'requestLogs',
        'resetChains',
        'savings',
        'quotaWindows',
        'codexRuns',
        'resetCredits',
        'serviceStatus',
        'signalPrediction',
        'stale',
      ].sort(),
    )
  })

  it('keeps field types stable for empty stores', async () => {
    const controller = await createController()
    const model = await controller.snapshot()
    expect(model.monitorMode).toBe('rule-only')
    expect(model.serviceStatus).toBe('starting')
    expect(['disabled', 'current', 'stale', 'updating', 'error']).toContain(
      model.dataStatus,
    )
    expect(Array.isArray(model.posts)).toBe(true)
    expect(Array.isArray(model.events)).toBe(true)
    expect(Array.isArray(model.resetChains)).toBe(true)
    expect(Array.isArray(model.latestEvidence)).toBe(true)
    expect(Array.isArray(model.requestLogs)).toBe(true)
    expect(
      model.prediction24h === null || typeof model.prediction24h === 'string',
    ).toBe(true)
    expect(
      model.signalPrediction === null ||
        typeof model.signalPrediction === 'object',
    ).toBe(true)
  })

  it('locks the details audit sections used by the inspector views', async () => {
    const controller = await createController()
    const { details } = await controller.snapshot()
    expect(Object.keys(details!).sort()).toEqual(
      ['analysis', 'event', 'notification', 'post', 'resume'].sort(),
    )
    for (const section of Object.values(details!)) {
      expect(Array.isArray(section)).toBe(true)
    }
  })
})
