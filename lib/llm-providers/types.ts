import type { LlmProviderAuthKind, LlmProviderKey } from './providers'

export const LLM_PROVIDER_CONNECTIONS_COLLECTION = 'llm_provider_connections'
export const LLM_OAUTH_SESSIONS_COLLECTION = 'llm_oauth_sessions'
export const LLM_CREDENTIAL_BINDINGS_COLLECTION = 'llm_credential_bindings'

export type LlmConnectionScope = 'org' | 'user'
export type LlmConnectionStatus = 'connected' | 'invalid' | 'revoked' | 'reauth_required' | 'pending_oauth'

export interface LlmProviderConnection {
  id: string
  provider: LlmProviderKey
  hermesProvider: string
  authKind: LlmProviderAuthKind | 'oauth_token'
  scope: LlmConnectionScope
  orgId: string
  ownerUid: string | null
  label: string
  status: LlmConnectionStatus
  credentialsEnc: { ciphertext: string; iv: string; tag: string } | null
  scopeKeyRef: string
  credentialHint: string
  meta: Record<string, unknown>
  /** Monotonic account credential generation. Incremented whenever credentials are replaced. */
  credentialVersion: number
  /** Agent ids last synced to Hermes (env / auth.json). */
  syncedAgentIds: string[]
  lastValidatedAt: unknown
  lastUsedAt: unknown
  lastSyncedAt: unknown
  lastError: string | null
  createdAt: unknown
  updatedAt: unknown
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
}

export type LlmProviderConnectionMasked = Omit<LlmProviderConnection, 'credentialsEnc'> & {
  hasCredentials: boolean
}

export interface LlmOauthSession {
  id: string
  provider: LlmProviderKey
  hermesProvider: string
  orgId: string
  ownerUid: string
  scope: LlmConnectionScope
  label: string
  status: 'pending' | 'completed' | 'expired' | 'failed'
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string | null
  tokenEndpoint: string
  expiresAt: string
  intervalSeconds: number
  error: string | null
  createdAt: unknown
  updatedAt: unknown
}

export type LlmOauthSessionPublic = Omit<LlmOauthSession, 'deviceCode' | 'tokenEndpoint'>

export function llmConnectionId(input: {
  provider: LlmProviderKey
  scope: LlmConnectionScope
  orgId: string
  ownerUid: string | null
}): string {
  if (input.scope === 'user') {
    if (!input.ownerUid) throw new Error('ownerUid is required for user-scoped connections')
    return `user:${input.ownerUid}:${input.provider}`
  }
  return `org:${input.orgId}:${input.provider}`
}

export function llmConnectionScopeKey(input: Pick<LlmProviderConnection, 'scope' | 'orgId' | 'ownerUid'>): string {
  if (input.scope === 'user') {
    if (!input.ownerUid) throw new Error('ownerUid is required for user-scoped connections')
    return `user:${input.ownerUid}`
  }
  return `org:${input.orgId}`
}

export function maskLlmConnection(connection: LlmProviderConnection): LlmProviderConnectionMasked {
  const { credentialsEnc, ...rest } = connection
  return { ...rest, hasCredentials: Boolean(credentialsEnc) }
}

export type LlmCredentialBindingStatus =
  | 'desired'
  | 'delivering'
  | 'stored'
  | 'ready'
  | 'failed'
  | 'revoked'

/**
 * Machine/profile-specific proof that one connected account can be used by chat.
 * A provider connection is not chat-ready until this exact binding is `ready`.
 */
export interface LlmCredentialBinding {
  id: string
  connectionId: string
  credentialVersion: number
  orgId: string
  ownerUid: string | null
  scope: LlmConnectionScope
  provider: LlmProviderKey
  hermesProvider: string
  runtimeTargetId: string
  deviceId: string | null
  machineLabel: string
  agentId: string
  status: LlmCredentialBindingStatus
  liveAuthVerified: boolean
  verifiedModelIds: string[]
  lastError: string | null
  deliveryJobId: string | null
  lastVerifiedAt: unknown
  createdAt: unknown
  updatedAt: unknown
}

export function publicOauthSession(session: LlmOauthSession): LlmOauthSessionPublic {
  const { deviceCode: _deviceCode, tokenEndpoint: _tokenEndpoint, ...rest } = session
  return rest
}
