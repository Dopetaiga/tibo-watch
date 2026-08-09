import { describe, expect, it } from 'vitest'
import { MemoryCredentialStore } from '../../app/adapters/credentials/memory-store'

describe('credential store contract', () => {
  it('returns only an irreversible hint to application state', async () => {
    const store = new MemoryCredentialStore()
    await store.set('deepseek', 'default', 'sk-secret-value')
    expect(await store.hint('deepseek', 'default')).toBe('已配置（长度 15）')
    expect(await store.hint('deepseek', 'default')).not.toContain('secret')
    await store.delete('deepseek', 'default')
    expect(await store.get('deepseek', 'default')).toBeNull()
  })
})
