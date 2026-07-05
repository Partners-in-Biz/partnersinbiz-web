import type { CreativeCanvasProviderKey } from '../types'

export const CREATIVE_PROVIDER_CONNECTIONS_COLLECTION = 'creative_provider_connections'

export type CreativeProviderConnectionScope = 'org' | 'user'
export type CreativeProviderConnectionStatus = 'connected' | 'invalid' | 'revoked' | 'reauth_required'
export type CreativeProviderConnectionAuthKind = 'api_key' | 'api_key_secret' | 'oauth2'

export interface CreativeProviderConnection {
  id: string
  provider: CreativeCanvasProviderKey
  authKind: CreativeProviderConnectionAuthKind
  scope: CreativeProviderConnectionScope
  /** Org the connection was created in. Always set (audit); NOT a query key for user scope. */
  orgId: string
  ownerUid: string | null
  label: string
  status: CreativeProviderConnectionStatus
  /** AES-256-GCM blob via lib/social/encryption. Null after revoke. */
  credentialsEnc: { ciphertext: string; iv: string; tag: string } | null
  /** HMAC scope string used to derive the encryption key: orgId or `user:${uid}`. */
  scopeKeyRef: string
  /** Non-secret hint for the UI, e.g. "xai-…k3F9". */
  credentialHint: string
  meta: Record<string, unknown>
  lastValidatedAt: unknown | null
  lastUsedAt: unknown | null
  lastError: string | null
  createdAt: unknown
  updatedAt: unknown
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
}

/** Masked shape returned by every API — never contains credentialsEnc. */
export type CreativeProviderConnectionMasked = Omit<CreativeProviderConnection, 'credentialsEnc'> & {
  hasCredentials: boolean
}

export function creativeProviderConnectionId(input: {
  provider: CreativeCanvasProviderKey
  scope: CreativeProviderConnectionScope
  orgId: string
  ownerUid: string | null
}): string {
  if (input.scope === 'user') {
    if (!input.ownerUid) throw new Error('ownerUid is required for user-scoped connections')
    return `user:${input.ownerUid}:${input.provider}`
  }
  return `org:${input.orgId}:${input.provider}`
}

export function connectionScopeKey(input: Pick<CreativeProviderConnection, 'scope' | 'orgId' | 'ownerUid'>): string {
  return input.scope === 'user' && input.ownerUid ? `user:${input.ownerUid}` : input.orgId
}

export function maskConnection(connection: CreativeProviderConnection): CreativeProviderConnectionMasked {
  const { credentialsEnc, ...rest } = connection
  return { ...rest, hasCredentials: Boolean(credentialsEnc) }
}
