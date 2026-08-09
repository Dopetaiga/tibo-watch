export interface CredentialStore {
  set(service: string, account: string, secret: string): Promise<void>
  get(service: string, account: string): Promise<string | null>
  delete(service: string, account: string): Promise<void>
  hint(service: string, account: string): Promise<string | null>
}

export function irreversibleSecretHint(secret: string): string {
  if (!secret) return '未配置'
  return `已配置（长度 ${secret.length}）`
}
