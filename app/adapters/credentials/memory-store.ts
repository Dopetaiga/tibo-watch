import type { CredentialStore } from './types.js'
import { irreversibleSecretHint } from './types.js'

export class MemoryCredentialStore implements CredentialStore {
  readonly #values = new Map<string, string>()

  async set(service: string, account: string, secret: string): Promise<void> {
    this.#values.set(`${service}:${account}`, secret)
  }
  async get(service: string, account: string): Promise<string | null> {
    return this.#values.get(`${service}:${account}`) ?? null
  }
  async delete(service: string, account: string): Promise<void> {
    this.#values.delete(`${service}:${account}`)
  }
  async hint(service: string, account: string): Promise<string | null> {
    const value = await this.get(service, account)
    return value ? irreversibleSecretHint(value) : null
  }
}
