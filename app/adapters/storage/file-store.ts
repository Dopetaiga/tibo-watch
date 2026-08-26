import { createHash, randomUUID } from 'node:crypto'
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises'
import path from 'node:path'
import type { FactRecord } from '../../domain/models.js'

export function contentHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex')
}

export class SerialWriteQueue {
  #tail: Promise<unknown> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation)
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  )
  const handle = await open(temporaryPath, 'wx')
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporaryPath, filePath)
}

export interface StoreOptions<T extends FactRecord> {
  rootDirectory: string
  collection: string
  idOf(record: T): string
  validate(record: unknown): record is T
}

export class JsonRecordStore<T extends FactRecord> {
  readonly #recordsDirectory: string
  readonly #indexPath: string
  readonly #quarantineDirectory: string
  readonly #queue = new SerialWriteQueue()
  // In-process authoritative cache. All writes go through this instance's
  // serial queue, so the cache never diverges from disk within the app.
  #cache: Map<string, T> | null = null

  constructor(readonly options: StoreOptions<T>) {
    this.#recordsDirectory = path.join(
      options.rootDirectory,
      options.collection,
    )
    this.#indexPath = path.join(
      options.rootDirectory,
      'indexes',
      `${options.collection}.jsonl`,
    )
    this.#quarantineDirectory = path.join(
      options.rootDirectory,
      'quarantine',
      options.collection,
    )
  }

  async put(record: T): Promise<{ created: boolean; record: T }> {
    if (!this.options.validate(record))
      throw new Error('记录未通过 schema 校验')
    return this.#queue.run(async () => {
      const id = this.options.idOf(record)
      const filePath = this.recordPath(id)
      try {
        const existing = await this.get(id)
        if (existing.contentHash === record.contentHash)
          return { created: false, record: existing }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await atomicWrite(filePath, `${JSON.stringify(record, null, 2)}\n`)
      // O(1) index append instead of a full O(n) rebuild on every write.
      // Duplicate ids are legal after content-hash updates; readers take the
      // last occurrence and ensureIndexIntact() compacts when counts drift.
      try {
        await this.#appendIndexEntry(id, record.createdAt, record.contentHash)
      } catch {
        // The record replacement is already durable. Rebuild the auxiliary
        // index before reporting success, and invalidate the cache first so a
        // failed repair can never leave list() serving the previous record.
        this.#cache = null
        await this.#rebuildIndex()
      }
      if (this.#cache) this.#cache.set(id, record)
      return { created: true, record }
    })
  }

  async get(id: string): Promise<T> {
    if (this.#cache) {
      const cached = this.#cache.get(id)
      if (cached) return cached
    }
    const value: unknown = JSON.parse(
      await readFile(this.recordPath(id), 'utf8'),
    )
    if (!this.options.validate(value))
      throw new Error(`记录 ${id} 未通过 schema 校验`)
    return value
  }

  async list(): Promise<T[]> {
    if (this.#cache) return [...this.#cache.values()]
    return this.#readAllFromDisk()
  }

  async #readAllFromDisk(): Promise<T[]> {
    await mkdir(this.#recordsDirectory, { recursive: true })
    const names = (await readdir(this.#recordsDirectory))
      .filter((name) => name.endsWith('.json'))
      .sort()
    const records: T[] = []
    const cache = new Map<string, T>()
    for (const name of names) {
      const id = name.slice(0, -5)
      try {
        const value: unknown = JSON.parse(
          await readFile(this.recordPath(id), 'utf8'),
        )
        if (!this.options.validate(value))
          throw new Error(`记录 ${id} 未通过 schema 校验`)
        records.push(value)
        cache.set(id, value)
      } catch {
        await this.quarantine(id)
      }
    }
    this.#cache = cache
    return records
  }

  async rebuildIndex(): Promise<number> {
    return this.#queue.run(() => this.#rebuildIndex())
  }

  async #rebuildIndex(): Promise<number> {
    // Force a disk pass so externally drifted state (files added/removed
    // outside this process) is picked up and the cache resynchronized.
    const records = await this.#readAllFromDisk()
    const lines = records.map((record) =>
      JSON.stringify({
        id: this.options.idOf(record),
        createdAt: record.createdAt,
        contentHash: record.contentHash,
      }),
    )
    await atomicWrite(
      this.#indexPath,
      lines.length ? `${lines.join('\n')}\n` : '',
    )
    return records.length
  }

  /**
   * Heals a missing, corrupted, or stale index once per store lifetime.
   * Returns true when a compaction was performed. Duplicate lines from
   * appends are only considered drift when the unique id set no longer
   * matches the record files on disk.
   */
  async ensureIndexIntact(): Promise<boolean> {
    let names: string[]
    try {
      names = (await readdir(this.#recordsDirectory)).filter((name) =>
        name.endsWith('.json'),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.rebuildIndex()
        return true
      }
      throw error
    }
    const indexedIds = new Set<string>()
    try {
      const content = await readFile(this.#indexPath, 'utf8')
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const entry = JSON.parse(line) as { id?: unknown }
          if (typeof entry.id === 'string') indexedIds.add(entry.id)
        } catch {
          indexedIds.add(`__corrupt_${indexedIds.size}`)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const fileIds = new Set(names.map((name) => name.slice(0, -5)))
    if (indexedIds.size !== fileIds.size) {
      await this.rebuildIndex()
      return true
    }
    for (const id of fileIds)
      if (!indexedIds.has(id)) {
        await this.rebuildIndex()
        return true
      }
    return false
  }

  async #appendIndexEntry(
    id: string,
    createdAt: string,
    contentHash: string,
  ): Promise<void> {
    await mkdir(path.dirname(this.#indexPath), { recursive: true })
    await appendFile(
      this.#indexPath,
      `${JSON.stringify({ id, createdAt, contentHash })}\n`,
      'utf8',
    )
  }

  async backup(destination: string): Promise<number> {
    const records = await this.list()
    await mkdir(destination, { recursive: true })
    for (const record of records) {
      await atomicWrite(
        path.join(destination, `${this.options.idOf(record)}.json`),
        `${JSON.stringify(record, null, 2)}\n`,
      )
    }
    return records.length
  }

  async exportJson(): Promise<string> {
    return `${JSON.stringify(await this.list(), null, 2)}\n`
  }

  async importJson(contents: string): Promise<number> {
    const values: unknown = JSON.parse(contents)
    if (!Array.isArray(values)) throw new Error('导入内容必须是 JSON 数组')
    for (const value of values) {
      if (!this.options.validate(value))
        throw new Error('导入记录未通过 schema 校验')
    }
    for (const value of values) await this.put(value)
    return values.length
  }

  async deleteWhere(predicate: (record: T) => boolean): Promise<number> {
    return this.#queue.run(async () => {
      const records = await this.list()
      let deleted = 0
      for (const record of records) {
        if (!predicate(record)) continue
        try {
          await unlink(this.recordPath(this.options.idOf(record)))
          this.#cache?.delete(this.options.idOf(record))
          deleted += 1
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      if (deleted > 0) await this.#rebuildIndex()
      return deleted
    })
  }

  recordPath(id: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('记录 ID 包含非法字符')
    return path.join(this.#recordsDirectory, `${id}.json`)
  }

  async quarantine(id: string): Promise<void> {
    await mkdir(this.#quarantineDirectory, { recursive: true })
    const source = this.recordPath(id)
    const target = path.join(
      this.#quarantineDirectory,
      `${id}.${Date.now()}.json`,
    )
    try {
      await stat(source)
      await rename(source, target)
      this.#cache?.delete(id)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
