import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RuntimeController } from '../../app/main/runtime-controller'
import { MemoryCredentialStore } from '../../app/adapters/credentials/memory-store'
import { JsonRecordStore } from '../../app/adapters/storage/file-store'
import { isPost } from '../../app/domain/schemas'
import type { Post } from '../../app/domain/models'

// Opt-in performance harness (run with TIBO_PERF=1 npx vitest run <this file>).
// Records the P0 baseline referenced by tibo-watch-OxAlpha/ROADMAP.md.
const temporaryDirectories: string[] = []
const perfEnabled = process.env.TIBO_PERF === '1'

function post(index: number): Post {
  const postId = `perf-${String(index).padStart(4, '0')}`
  const postedAt = new Date(2026, 0, 1, 0, index % 1440).toISOString()
  return {
    schemaVersion: 1,
    createdAt: postedAt,
    source: 'fxtwitter',
    contentHash: `a${String(index).padStart(63, '0')}`,
    postId,
    url: `https://x.com/thsottiaux/status/${index}`,
    author: 'thsottiaux',
    text: `fixture ${index} reset`,
    postedAt,
    kind: 'original',
    parentPostId: null,
    quotedPostId: null,
  }
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe.skipIf(!perfEnabled)('snapshot performance baseline', () => {
  it(
    'measures seed + snapshot cost at 500 posts',
    { timeout: 600_000 },
    async () => {
      const dataRoot = await mkdtemp(path.join(tmpdir(), 'tibo-watch-perf-'))
      temporaryDirectories.push(dataRoot)
      const posts = new JsonRecordStore<Post>({
        rootDirectory: dataRoot,
        collection: 'posts',
        idOf: (record) => record.postId,
        validate: isPost,
      })

      const seedStarted = process.hrtime.bigint()
      for (let index = 0; index < 500; index += 1) await posts.put(post(index))
      const seedMs = Number(process.hrtime.bigint() - seedStarted) / 1_000_000

      const controller = new RuntimeController(
        dataRoot,
        async () => {},
        new MemoryCredentialStore(),
      )
      const snapshots: number[] = []
      let payloadBytes = 0
      for (let round = 0; round < 5; round += 1) {
        const started = process.hrtime.bigint()
        const model = await controller.snapshot()
        payloadBytes = Buffer.byteLength(JSON.stringify(model), 'utf8')
        snapshots.push(Number(process.hrtime.bigint() - started) / 1_000_000)
      }
      snapshots.sort((left, right) => left - right)

      const report = {
        seed500PutMs: Math.round(seedMs),
        snapshotMedianMs: Math.round(snapshots[2]),
        snapshotMaxMs: Math.round(snapshots.at(-1)!),
        snapshotPayloadKB: Math.round(payloadBytes / 1024),
      }
      console.log('PERF_BASELINE', JSON.stringify(report))
      expect(report.snapshotMaxMs).toBeGreaterThan(0)
    },
  )
})
