import { AGENT_ID_RE } from '@/lib/agents/types'
import type { LlmProviderAuthKind, LlmProviderKey } from './providers'

export const LLM_PROVIDER_CONNECTIONS_COLLECTION = 'llm_provider_connections'
export const LLM_OAUTH_SESSIONS_COLLECTION = 'llm_oauth_sessions'
export const LLM_CREDENTIAL_BINDINGS_COLLECTION = 'llm_credential_bindings'
export const LLM_CREDENTIAL_AUDIT_COLLECTION = 'llm_credential_audit'

export type LlmShareMode = 'admins' | 'organization' | 'teams' | 'selected_users'

export interface LlmShareTargets {
  mode: LlmShareMode
  teamIds: string[]
  userIds: string[]
  agentIds: string[]
  requireActiveDeviceGrant: true
}

export const DEFAULT_LLM_SHARE_TARGETS: LlmShareTargets = {
  mode: 'admins', teamIds: [], userIds: [], agentIds: [], requireActiveDeviceGrant: true,
}

export function normalizeLlmShareTargets(value: unknown): LlmShareTargets {
  if (!value || typeof value !== 'object') return DEFAULT_LLM_SHARE_TARGETS
  const row = value as Record<string, unknown>
  const mode: LlmShareMode = row.mode === 'organization' || row.mode === 'teams' || row.mode === 'selected_users' ? row.mode : 'admins'
  const strings = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()))].slice(0, 500) : []
  return { mode, teamIds: strings(row.teamIds), userIds: strings(row.userIds), agentIds: strings(row.agentIds).filter((id) => AGENT_ID_RE.test(id)), requireActiveDeviceGrant: true }
}

export type LlmConnectionScope = 'org' | 'user'
export type LlmConnectionStatus = 'connected' | 'invalid' | 'revoked' | 'reauth_required' | 'pending_oauth'

/** AES-256-GCM encrypted blob — same shape as the social token encryption. */
export interface EncryptedSessionData {
  ciphertext: string
  iv: string
  tag: string
}

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
  /** Org-scope sharing. Absent on user connections; treat missing as DEFAULT_LLM_SHARE_TARGETS. */
  shareTargets?: LlmShareTargets
  createdAt: unknown
  updatedAt: unknown
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
}

export type LlmProviderConnectionMasked = Omit<LlmProviderConnection, 'credentialsEnc'> & {
  hasCredentials: boolean
}

export type LlmOauthFlow = 'device_code' | 'authorization_code'

export interface LlmOauthSession {
  id: string
  provider: LlmProviderKey
  hermesProvider: string
  orgId: string
  ownerUid: string
  scope: LlmConnectionScope
  label: string
  /** Which OAuth variant this session represents. */
  flow: LlmOauthFlow
  status: 'pending' | 'awaiting_code' | 'completed' | 'expired' | 'failed'
  /** authorization_code only: the URL the human approves in a browser tab. */
  authorizeUrl: string | null
  /** authorization_code only: OAuth state (Claude Code derives it from the verifier). Never public. */
  state: string | null
  /** authorization_code only: PKCE verifier, encrypted at rest like other session secrets. Never public. */
  verifierEnc: EncryptedSessionData | null
  deviceCode: string
  userCode: string
  verificationUri: string | null
  verificationUriComplete: string | null
  tokenEndpoint: string | null
  expiresAt: string
  intervalSeconds: number
  error: string | null
  createdAt: unknown
  updatedAt: unknown
}

export type LlmOauthSessionPublic = Omit<
  LlmOauthSession,
  'deviceCode' | 'tokenEndpoint' | 'verifierEnc' | 'state'
>

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
  | 'revoke_pending'

export type LlmCredentialAuditAction =
  | 'binding.delivered'
  | 'binding.ready'
  | 'binding.failed'
  | 'binding.revoke_enqueued'
  | 'binding.revoked'
  | 'binding.revoke_pending'
  | 'binding.revoke_stale'
  | 'share_targets.changed'

export interface LlmCredentialAuditEvent {
  eventId: string
  action: LlmCredentialAuditAction
  connectionId: string
  bindingId?: string
  orgId: string
  actorUserId: string | 'system'
  deviceId?: string
  agentId?: string
  reason?: string
  createdAt: unknown
}

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
  /** Set once by the stale revoke_pending sweep so it audits only once. */
  staleFlaggedAt?: unknown
}

export function publicOauthSession(session: LlmOauthSession): LlmOauthSessionPublic {
  const {
    deviceCode: _deviceCode,
    tokenEndpoint: _tokenEndpoint,
    verifierEnc: _verifierEnc,
    state: _state,
    ...rest
  } = session
  return rest
}
