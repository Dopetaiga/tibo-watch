import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface V2MigrationResult {
  migrated: boolean
  backupDirectory: string | null
}

export async function ensureV2MigrationBackup(
  dataRoot: string,
): Promise<V2MigrationResult> {
  const marker = path.join(dataRoot, '.v2-migration.json')
  try {
    const value = JSON.parse(await readFile(marker, 'utf8')) as {
      schemaVersion?: number
    }
    if (value.schemaVersion === 2)
      return { migrated: false, backupDirectory: null }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  let hasExistingData = false
  try {
    hasExistingData = (await stat(dataRoot)).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(dataRoot, { recursive: true })

  let backupDirectory: string | null = null
  if (hasExistingData) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    backupDirectory = path.join(
      path.dirname(dataRoot),
      'backups',
      `v1-${stamp}`,
    )
    await cp(dataRoot, backupDirectory, {
      recursive: true,
      filter: (source) => path.resolve(source) !== path.resolve(marker),
    })
  }
  await writeFile(
    marker,
    `${JSON.stringify(
      {
        schemaVersion: 2,
        migratedAt: new Date().toISOString(),
        backupDirectory,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return { migrated: true, backupDirectory }
}
