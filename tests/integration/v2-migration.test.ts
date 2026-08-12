import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureV2MigrationBackup } from '../../app/adapters/storage/v2-migration'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

describe('V1 to V2 migration guard', () => {
  it('backs up existing facts once and writes an idempotent marker', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tibo-watch-v2-'))
    roots.push(root)
    const data = path.join(root, 'data')
    await (
      await import('node:fs/promises')
    ).mkdir(path.join(data, 'posts'), {
      recursive: true,
    })
    await writeFile(path.join(data, 'posts', 'one.json'), '{"id":"one"}\n')

    const first = await ensureV2MigrationBackup(data)
    expect(first.migrated).toBe(true)
    expect(first.backupDirectory).not.toBeNull()
    expect(
      await readFile(
        path.join(first.backupDirectory!, 'posts', 'one.json'),
        'utf8',
      ),
    ).toContain('one')

    const second = await ensureV2MigrationBackup(data)
    expect(second).toEqual({ migrated: false, backupDirectory: null })
    expect(
      JSON.parse(await readFile(path.join(data, '.v2-migration.json'), 'utf8')),
    ).toMatchObject({ schemaVersion: 2 })
  })
})
