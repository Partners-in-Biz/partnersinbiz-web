import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { encryptToken } from '@/lib/social/encryption'
import type { LlmProviderKey } from '../providers'
import {
  LLM_OAUTH_SESSIONS_COLLECTION,
  llmConnectionScopeKey,
  publicOauthSession,
  type EncryptedSessionData,
  type LlmConnectionScope,
  type LlmOauthFlow,
  type LlmOauthSession,
  type LlmOauthSessionPublic,
} from '../types'

export interface CreateOauthSessionInput {
  provider: LlmProviderKey
  hermesProvider: string
  orgId: string
  ownerUid: string
  scope: LlmConnectionScope
  label: string
  /** Defaults to device_code; anthropic uses authorization_code. */
  flow?: LlmOauthFlow
  /** authorization_code: status is 'awaiting_code' until the human pastes the code. */
  status?: 'pending' | 'awaiting_code'
  /** authorization_code: URL the human approves in a browser tab. */
  authorizeUrl?: string | null
  /** authorization_code: OAuth state (== verifier for Claude Code). */
  state?: string | null
  /** authorization_code: raw PKCE verifier — encrypted before it is stored. */
  verifier?: string | null
  deviceCode?: string
  userCode?: string
  verificationUri?: string | null
  verificationUriComplete?: string | null
  tokenEndpoint?: string | null
  expiresIn?: number
  intervalSeconds?: number
}

export async function createOauthSession(input: CreateOauthSessionInput): Promise<LlmOauthSessionPublic> {
  const id = `oauth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  const flow: LlmOauthFlow = input.flow ?? 'device_code'
  const expiresIn = Math.max(input.expiresIn ?? 900, 60)
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  let verifierEnc: EncryptedSessionData | null = null
  if (input.verifier) {
    // The PKCE verifier is a session secret: never stored or returned in the
    // clear. Encrypt with the same scope key used for connection credentials.
    verifierEnc = encryptToken(
      input.verifier,
      llmConnectionScopeKey({ scope: input.scope, orgId: input.orgId, ownerUid: input.ownerUid }),
    )
  }

  const doc: Omit<LlmOauthSession, 'createdAt' | 'updatedAt'> = {
    id,
    provider: input.provider,
    hermesProvider: input.hermesProvider,
    orgId: input.orgId,
    ownerUid: input.ownerUid,
    scope: input.scope,
    label: input.label,
    flow,
    status: input.status ?? 'pending',
    authorizeUrl: input.authorizeUrl ?? null,
    state: input.state ?? null,
    verifierEnc,
    deviceCode: input.deviceCode ?? '',
    userCode: input.userCode ?? '',
    verificationUri: input.verificationUri ?? null,
    verificationUriComplete: input.verificationUriComplete ?? null,
    tokenEndpoint: input.tokenEndpoint ?? null,
    expiresAt,
    intervalSeconds: Math.max(input.intervalSeconds ?? 5, 0),
    error: null,
  }
  await adminDb.collection(LLM_OAUTH_SESSIONS_COLLECTION).doc(id).set({
    ...doc,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return publicOauthSession({ ...doc, createdAt: null, updatedAt: null })
}

/** @internal Includes deviceCode/verifier — never return from list APIs. */
export async function getOauthSession(id: string): Promise<LlmOauthSession | null> {
  const snap = await adminDb.collection(LLM_OAUTH_SESSIONS_COLLECTION).doc(id).get()
  return snap.exists ? { ...(snap.data() as LlmOauthSession), id: snap.id } : null
}

export async function updateOauthSession(
  id: string,
  patch: Partial<Pick<LlmOauthSession, 'status' | 'error' | 'intervalSeconds'>>,
): Promise<void> {
  await adminDb.collection(LLM_OAUTH_SESSIONS_COLLECTION).doc(id).update({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  })
}
