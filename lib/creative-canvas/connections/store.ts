/**
 * Firestore CRUD for `creative_provider_connections` (BYOK credentials).
 * Visibility rule: a caller sees their own user-scoped connections plus
 * every org-scoped connection for their active org. Credentials are
 * always encrypted at rest and never leave this module in plaintext —
 * every read/list/upsert/revoke returns the masked shape.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { CreativeCanvasActor, CreativeCanvasProviderKey } from '../types'
import {
  CREATIVE_PROVIDER_CONNECTIONS_COLLECTION,
  creativeProviderConnectionId,
  connectionScopeKey,
  maskConnection,
  type CreativeProviderConnection,
  type CreativeProviderConnectionMasked,
  type CreativeProviderConnectionScope,
} from './types'
import { encryptConnectionCredentials, type ConnectionCredentials } from './crypto'

function credentialHint(credentials: ConnectionCredentials): string {
  const primary = credentials.apiKey ?? Object.values(credentials)[0] ?? ''
  if (primary.length <= 8) return '…'
  const dash = primary.indexOf('-')
  const prefixLen = dash > 0 && dash <= 4 ? dash + 1 : 4
  return `${primary.slice(0, prefixLen)}…${primary.slice(-4)}`
}

export interface UpsertConnectionInput {
  provider: CreativeCanvasProviderKey
  scope: CreativeProviderConnectionScope
  orgId: string
  ownerUid: string | null
  label: string
  credentials: ConnectionCredentials
  meta?: Record<string, unknown>
}

export async function upsertCreativeProviderConnection(
  input: UpsertConnectionInput,
  actor: CreativeCanvasActor,
): Promise<CreativeProviderConnectionMasked> {
  const id = creativeProviderConnectionId(input)
  const scopeKeyRef = connectionScopeKey(input)
  const doc: Omit<CreativeProviderConnection, 'createdAt' | 'updatedAt'> = {
    id,
    provider: input.provider,
    authKind: input.credentials.apiSecret ? 'api_key_secret' : 'api_key',
    scope: input.scope,
    orgId: input.orgId,
    ownerUid: input.scope === 'user' ? input.ownerUid : null,
    label: input.label.trim() || input.provider,
    status: 'connected',
    credentialsEnc: encryptConnectionCredentials(input.credentials, scopeKeyRef),
    scopeKeyRef,
    credentialHint: credentialHint(input.credentials),
    meta: input.meta ?? {},
    lastValidatedAt: null,
    lastUsedAt: null,
    lastError: null,
    createdBy: actor.uid,
    createdByType: actor.type,
  }
  const ref = adminDb.collection(CREATIVE_PROVIDER_CONNECTIONS_COLLECTION).doc(id)
  const existing = await ref.get()
  await ref.set({
    ...doc,
    createdAt: existing.exists ? (existing.data() as CreativeProviderConnection).createdAt : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  const saved = await ref.get()
  return maskConnection({ ...(saved.data() as CreativeProviderConnection), id })
}

/**
 * @internal Raw accessor — the returned doc includes `credentialsEnc`.
 * Never return this from an API route; always pass through `maskConnection`.
 */
export async function getCreativeProviderConnection(id: string): Promise<CreativeProviderConnection | null> {
  const snap = await adminDb.collection(CREATIVE_PROVIDER_CONNECTIONS_COLLECTION).doc(id).get()
  return snap.exists ? { ...(snap.data() as CreativeProviderConnection), id: snap.id } : null
}

/** Visible = the caller's own user-scoped connections + the active org's org-scoped ones. */
export async function listCreativeProviderConnections(input: {
  orgId: string
  uid: string
}): Promise<CreativeProviderConnectionMasked[]> {
  const col = adminDb.collection(CREATIVE_PROVIDER_CONNECTIONS_COLLECTION)
  const [orgSnap, userSnap] = await Promise.all([
    col.where('scope', '==', 'org').where('orgId', '==', input.orgId).get(),
    col.where('scope', '==', 'user').where('ownerUid', '==', input.uid).get(),
  ])
  return [...orgSnap.docs, ...userSnap.docs]
    .map((doc) => maskConnection({ ...(doc.data() as CreativeProviderConnection), id: doc.id }))
    .filter((conn) => conn.status !== 'revoked')
}

/** Authorization: org-scoped → caller must be in that org; user-scoped → caller must own it. */
export function canManageConnection(conn: CreativeProviderConnection, caller: { orgId: string; uid: string }): boolean {
  return conn.scope === 'user' ? conn.ownerUid === caller.uid : conn.orgId === caller.orgId
}

export async function revokeCreativeProviderConnection(
  id: string,
  caller: { orgId: string; uid: string },
  actor: CreativeCanvasActor,
): Promise<CreativeProviderConnectionMasked> {
  const conn = await getCreativeProviderConnection(id)
  if (!conn) throw new Error('Connection not found')
  if (!canManageConnection(conn, caller)) throw new Error('Forbidden')
  await adminDb.collection(CREATIVE_PROVIDER_CONNECTIONS_COLLECTION).doc(id).update({
    status: 'revoked',
    credentialsEnc: null,
    updatedAt: FieldValue.serverTimestamp(),
  })
  const updated = await getCreativeProviderConnection(id)
  return maskConnection(updated as CreativeProviderConnection)
}

export async function markConnectionValidation(
  id: string,
  result: { ok: boolean; error?: string },
): Promise<void> {
  await adminDb.collection(CREATIVE_PROVIDER_CONNECTIONS_COLLECTION).doc(id).update({
    status: result.ok ? 'connected' : 'invalid',
    lastValidatedAt: FieldValue.serverTimestamp(),
    lastError: result.ok ? null : (result.error ?? 'Validation failed'),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

export async function markConnectionUsed(id: string): Promise<void> {
  await adminDb.collection(CREATIVE_PROVIDER_CONNECTIONS_COLLECTION).doc(id).update({
    lastUsedAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined)
}
