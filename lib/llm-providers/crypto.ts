import { encryptToken, decryptToken, type EncryptedData } from '@/lib/social/encryption'

export type LlmConnectionCredentials = Record<string, string>

export function encryptLlmCredentials(credentials: LlmConnectionCredentials, scopeKey: string): EncryptedData {
  return encryptToken(JSON.stringify(credentials), scopeKey)
}

export function decryptLlmCredentials(blob: EncryptedData, scopeKey: string): LlmConnectionCredentials {
  return JSON.parse(decryptToken(blob, scopeKey)) as LlmConnectionCredentials
}
