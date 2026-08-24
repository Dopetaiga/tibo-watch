import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonRecordStore } from '../../app/adapters/storage/file-store'
import { isFactRecord, type Post } from '../../app/domain/models'

const temporaryDirectories: string[] = []

async function createStore() {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'tibo-watch-store-'))
  temporaryDirectories.push(rootDirectory)
  return {
    rootDirectory,
    store: new JsonRecordStore<Post>({
      rootDirectory,
      collection: 'posts',
      idOf: (post) => post.postId,
      validate: (value): value is Post =>
        isFactRecord(value) &&
        typeof (value as Partial<Post>).postId === 'string',
    }),
  }
}

function post(postId: string, hashCharacter = 'a'): Post {
  return {
    schemaVersion: 1,
    createdAt: '2026-08-09T00:00:00.000Z',
    source: 'fixture',
    contentHash: hashCharacter.repeat(64),
    postId,
    url: `https://x.com/thsottiaux/status/${postId}`,
    author: 'thsottiaux',
    text: 'fixture',
    postedAt: '2026-08-09T00:00:00.000Z',
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

describe('JSON record store', () => {
  it('writes atomically, deduplicates by content hash, and rebuilds JSONL indexes', async () => {
    const { rootDirectory, store } = await createStore()
    expect((await store.put(post('1'))).created).toBe(true)
    expect((await store.put(post('1'))).created).toBe(false)
    expect((await store.put(post('1', 'b'))).created).toBe(true)
    expect((await store.get('1')).contentHash).toBe('b'.repeat(64))
    expect(await store.rebuildIndex()).toBe(1)
    const index = await readFile(
      path.join(rootDirectory, 'indexes', 'posts.jsonl'),
      'utf8',
    )
    expect(index.trim().split('\n')).toHaveLength(1)
  })

  it('quarantines corrupt records while preserving valid facts', async () => {
    const { rootDirectory, store } = await createStore()
    await store.put(post('valid'))
    await writeFile(
      path.join(rootDirectory, 'posts', 'broken.json'),
      '{broken',
      'utf8',
    )
    expect((await store.list()).map(({ postId }) => postId)).toEqual(['valid'])
    const quarantine = path.join(rootDirectory, 'quarantine', 'posts')
    expect(await readFile(store.recordPath('valid'), 'utf8')).toContain(
      '"postId": "valid"',
    )
    await expect(
      (await import('node:fs/promises')).readdir(quarantine),
    ).resolves.toHaveLength(1)
  })

  it('ignores an interrupted temporary write', async () => {
    const { rootDirectory, store } = await createStore()
    await store.put(post('stable'))
    await writeFile(
      path.join(rootDirectory, 'posts', '.stable.interrupted.tmp'),
      '{"partial":',
      'utf8',
    )
    expect((await store.list()).map(({ postId }) => postId)).toEqual(['stable'])
    expect((await store.get('stable')).contentHash).toBe('a'.repeat(64))
  })

  it('exports and imports validated records without duplication', async () => {
    const first = await createStore()
    await first.store.put(post('one'))
    await first.store.put(post('two', 'b'))
    const exported = await first.store.exportJson()
    const second = await createStore()
    expect(await second.store.importJson(exported)).toBe(2)
    expect((await second.store.list()).map(({ postId }) => postId)).toEqual([
      'one',
      'two',
    ])
  })

  it('deletes only matching records and rebuilds the index', async () => {
    const { store } = await createStore()
    await store.put(post('keep'))
    await store.put(post('remove', 'b'))
    expect(await store.deleteWhere((value) => value.postId === 'remove')).toBe(
      1,
    )
    expect((await store.list()).map(({ postId }) => postId)).toEqual(['keep'])
  })

  it('appends index entries incrementally and self-heals drift', async () => {
    const { rootDirectory, store } = await createStore()
    const indexPath = path.join(rootDirectory, 'indexes', 'posts.jsonl')
    await store.put(post('1'))
    await store.put(post('2', 'b'))
    await store.put(post('3', 'c'))
    expect(await readFile(indexPath, 'utf8')).toContain('"id":"1"')

    // A content-hash update appends a second line for the same id instead of
    // rewriting the whole index.
    await store.put(post('1', 'd'))
    expect((await store.get('1')).contentHash).toBe('d'.repeat(64))
    const linesAfterUpdate = (
      await readFile(indexPath, 'utf8')
    ).trim()
      .split('\n')
      .filter(Boolean)
    expect(linesAfterUpdate).toHaveLength(4)

    // Drift (a record file deleted out of band) is detected and compacted.
    await unlink(path.join(rootDirectory, 'posts', '2.json'))
    expect(await store.ensureIndexIntact()).toBe(true)
    expect(
      (await readFile(indexPath, 'utf8')).trim().split('\n'),
    ).toHaveLength(2)
    expect(await store.ensureIndexIntact()).toBe(false)
  })

  it('recreates a missing index during self-heal', async () => {
    const { rootDirectory, store } = await createStore()
    await store.put(post('only'))
    await rm(path.join(rootDirectory, 'indexes'), {
      recursive: true,
      force: true,
    })
    expect(await store.ensureIndexIntact()).toBe(true)
    expect(
      await readFile(path.join(rootDirectory, 'indexes', 'posts.jsonl'), 'utf8'),
    ).toContain('only')
  })
})
