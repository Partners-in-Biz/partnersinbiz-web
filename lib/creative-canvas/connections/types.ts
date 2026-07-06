/**
 * BYOK connection document types for `creative_provider_connections`.
 * Consumed by the store, resolver, and API routes in this folder — these
 * types define the shape persisted to Firestore and the ids/keys derived from it.
 */
import type { CreativeCanvasProvider, CreativeCanvasProviderKey } from '../types'

export const CREATIVE_PROVIDER_CONNECTIONS_COLLECTION = 'creative_provider_connections'

export type CreativeProviderConnectionScope = 'org' | 'user'
export type CreativeProviderConnectionStatus = 'connected' | 'invalid' | 'revoked' | 'reauth_required'
/** Derived from the canonical inline union on CreativeCanvasProvider['connection'] — single source of truth. */
export type CreativeProviderConnectionAuthKind = NonNullable<CreativeCanvasProvider['connection']>['authKind']

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
  /** HMAC scope string used to derive the encryption key: `org:${orgId}` or `user:${uid}`. */
  scopeKeyRef: string
  /** Non-secret hint for the UI, e.g. "xai-…k3F9". */
  credentialHint: string
  /** Provider-specific extras (e.g. Higgsfield key id, future Vertex projectId). */
  meta: Record<string, unknown>
  lastValidatedAt: unknown
  lastUsedAt: unknown
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

/**
 * Scope string used to derive the AES encryption key for a connection's
 * credentials. Prefixed on BOTH branches so an orgId can never collide with
 * a user scope key. Stored on the doc as `scopeKeyRef`.
 */
export function connectionScopeKey(input: Pick<CreativeProviderConnection, 'scope' | 'orgId' | 'ownerUid'>): string {
  if (input.scope === 'user') {
    if (!input.ownerUid) throw new Error('ownerUid is required for user-scoped connections')
    return `user:${input.ownerUid}`
  }
  return `org:${input.orgId}`
}

export function maskConnection(connection: CreativeProviderConnection): CreativeProviderConnectionMasked {
  const { credentialsEnc, ...rest } = connection
  return { ...rest, hasCredentials: Boolean(credentialsEnc) }
}
