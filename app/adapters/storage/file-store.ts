import { createHash, randomUUID } from 'node:crypto'
import {
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
      await this.rebuildIndex()
      return { created: true, record }
    })
  }

  async get(id: string): Promise<T> {
    const value: unknown = JSON.parse(
      await readFile(this.recordPath(id), 'utf8'),
    )
    if (!this.options.validate(value))
      throw new Error(`记录 ${id} 未通过 schema 校验`)
    return value
  }

  async list(): Promise<T[]> {
    await mkdir(this.#recordsDirectory, { recursive: true })
    const names = (await readdir(this.#recordsDirectory))
      .filter((name) => name.endsWith('.json'))
      .sort()
    const records: T[] = []
    for (const name of names) {
      const id = name.slice(0, -5)
      try {
        records.push(await this.get(id))
      } catch {
        await this.quarantine(id)
      }
    }
    return records
  }

  async rebuildIndex(): Promise<number> {
    const records = await this.list()
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
          deleted += 1
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      if (deleted > 0) await this.rebuildIndex()
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
