/**
 * Credential encryption for creative provider connections.
 * Thin wrapper over lib/social/encryption so org- and user-scoped
 * connections derive DIFFERENT keys: scopeKey is `orgId` for org scope
 * and `user:${uid}` for user scope (portable across orgs, unreadable by orgs).
 */
import { encryptToken, decryptToken, type EncryptedData } from '@/lib/social/encryption'

export type ConnectionCredentials = Record<string, string>

export function encryptConnectionCredentials(credentials: ConnectionCredentials, scopeKey: string): EncryptedData {
  return encryptToken(JSON.stringify(credentials), scopeKey)
}

export function decryptConnectionCredentials(blob: EncryptedData, scopeKey: string): ConnectionCredentials {
  return JSON.parse(decryptToken(blob, scopeKey)) as ConnectionCredentials
}
