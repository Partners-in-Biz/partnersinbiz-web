import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { LlmProviderKey } from '../providers'
import {
  LLM_OAUTH_SESSIONS_COLLECTION,
  publicOauthSession,
  type LlmConnectionScope,
  type LlmOauthSession,
  type LlmOauthSessionPublic,
} from '../types'

export async function createOauthSession(input: {
  provider: LlmProviderKey
  hermesProvider: string
  orgId: string
  ownerUid: string
  scope: LlmConnectionScope
  label: string
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string | null
  tokenEndpoint: string
  expiresIn: number
  intervalSeconds: number
}): Promise<LlmOauthSessionPublic> {
  const id = `oauth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  const expiresAt = new Date(Date.now() + input.expiresIn * 1000).toISOString()
  const doc: Omit<LlmOauthSession, 'createdAt' | 'updatedAt'> = {
    id,
    provider: input.provider,
    hermesProvider: input.hermesProvider,
    orgId: input.orgId,
    ownerUid: input.ownerUid,
    scope: input.scope,
    label: input.label,
    status: 'pending',
    deviceCode: input.deviceCode,
    userCode: input.userCode,
    verificationUri: input.verificationUri,
    verificationUriComplete: input.verificationUriComplete,
    tokenEndpoint: input.tokenEndpoint,
    expiresAt,
    intervalSeconds: input.intervalSeconds,
    error: null,
  }
  await adminDb.collection(LLM_OAUTH_SESSIONS_COLLECTION).doc(id).set({
    ...doc,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return publicOauthSession({ ...doc, createdAt: null, updatedAt: null })
}

/** @internal Includes deviceCode — never return from list APIs. */
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
