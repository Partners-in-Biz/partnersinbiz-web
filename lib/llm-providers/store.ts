import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getLlmProvider, type LlmProviderKey } from './providers'
import {
  LLM_PROVIDER_CONNECTIONS_COLLECTION,
  llmConnectionId,
  llmConnectionScopeKey,
  maskLlmConnection,
  normalizeLlmShareTargets,
  type LlmConnectionScope,
  type LlmProviderConnection,
  type LlmProviderConnectionMasked,
  type LlmShareTargets,
} from './types'
import { encryptLlmCredentials, type LlmConnectionCredentials } from './crypto'

function credentialHint(credentials: LlmConnectionCredentials): string {
  const primary = credentials.apiKey ?? credentials.access_token ?? Object.values(credentials)[0] ?? ''
  if (primary.length <= 8) return '…'
  const dash = primary.indexOf('-')
  const prefixLen = dash > 0 && dash <= 4 ? dash + 1 : 4
  return `${primary.slice(0, prefixLen)}…${primary.slice(-4)}`
}

export interface UpsertLlmConnectionInput {
  provider: LlmProviderKey
  scope: LlmConnectionScope
  orgId: string
  ownerUid: string | null
  label: string
  credentials: LlmConnectionCredentials
  authKind?: LlmProviderConnection['authKind']
  meta?: Record<string, unknown>
  status?: LlmProviderConnection['status']
  shareTargets?: LlmShareTargets
}

export async function upsertLlmProviderConnection(
  input: UpsertLlmConnectionInput,
  actor: { uid: string; type: 'user' | 'agent' | 'system' },
): Promise<LlmProviderConnectionMasked> {
  const def = getLlmProvider(input.provider)
  if (!def) throw new Error('Unknown provider')
  const id = llmConnectionId(input)
  const scopeKeyRef = llmConnectionScopeKey(input)
  const ref = adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION).doc(id)
  const existing = await ref.get()
  const existingData = existing.exists ? (existing.data() as LlmProviderConnection) : null
  const orgShareTargets = input.scope === 'org'
    ? normalizeLlmShareTargets(
        input.shareTargets !== undefined
          ? input.shareTargets
          : existingData?.shareTargets,
      )
    : undefined
  const doc: Omit<LlmProviderConnection, 'createdAt' | 'updatedAt'> = {
    id,
    provider: input.provider,
    hermesProvider: def.hermesProvider,
    authKind: input.authKind ?? (input.credentials.access_token ? 'oauth_token' : def.authKind),
    scope: input.scope,
    orgId: input.orgId,
    ownerUid: input.scope === 'user' ? input.ownerUid : null,
    label: input.label.trim() || def.label,
    status: input.status ?? 'connected',
    credentialsEnc: encryptLlmCredentials(input.credentials, scopeKeyRef),
    scopeKeyRef,
    credentialHint: credentialHint(input.credentials),
    meta: input.meta ?? {},
    credentialVersion: existing.exists
      ? Math.max(1, Number((existing.data() as LlmProviderConnection).credentialVersion ?? 1)) + 1
      : 1,
    syncedAgentIds: [],
    lastValidatedAt: null,
    lastUsedAt: null,
    lastSyncedAt: null,
    lastError: null,
    createdBy: actor.uid,
    createdByType: actor.type,
    ...(orgShareTargets ? { shareTargets: orgShareTargets } : {}),
  }
  await ref.set({
    ...doc,
    syncedAgentIds: existing.exists
      ? ((existing.data() as LlmProviderConnection).syncedAgentIds ?? [])
      : [],
    createdAt: existing.exists
      ? (existing.data() as LlmProviderConnection).createdAt
      : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  const saved = await ref.get()
  return maskLlmConnection({ ...(saved.data() as LlmProviderConnection), id })
}

/** @internal Includes credentialsEnc — never return from an API route. */
export async function getLlmProviderConnection(id: string): Promise<LlmProviderConnection | null> {
  const snap = await adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION).doc(id).get()
  return snap.exists ? { ...(snap.data() as LlmProviderConnection), id: snap.id } : null
}

export async function listLlmProviderConnections(input: {
  orgId: string
  uid: string
}): Promise<LlmProviderConnectionMasked[]> {
  const col = adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION)
  const [orgSnap, userSnap] = await Promise.all([
    col.where('scope', '==', 'org').where('orgId', '==', input.orgId).get(),
    col.where('scope', '==', 'user').where('ownerUid', '==', input.uid).get(),
  ])
  return [...orgSnap.docs, ...userSnap.docs]
    .map((doc) => maskLlmConnection({ ...(doc.data() as LlmProviderConnection), id: doc.id }))
    .filter((conn) => conn.status !== 'revoked')
}

export function canManageLlmConnection(
  conn: LlmProviderConnection,
  caller: { orgId: string; uid: string },
): boolean {
  return conn.scope === 'user' ? conn.ownerUid === caller.uid : conn.orgId === caller.orgId
}

export async function updateLlmConnectionShareTargets(
  id: string,
  shareTargets: LlmShareTargets,
  actor: { uid: string },
): Promise<LlmProviderConnectionMasked> {
  void actor
  const conn = await getLlmProviderConnection(id)
  if (!conn) throw new Error('Connection not found')
  if (conn.scope !== 'org') throw new Error('shareTargets only apply to organisation connections')
  await adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION).doc(id).update({
    shareTargets: normalizeLlmShareTargets(shareTargets),
    updatedAt: FieldValue.serverTimestamp(),
  })
  const updated = await getLlmProviderConnection(id)
  return maskLlmConnection(updated as LlmProviderConnection)
}

export async function revokeLlmProviderConnection(
  id: string,
  caller: { orgId: string; uid: string },
): Promise<LlmProviderConnectionMasked> {
  const conn = await getLlmProviderConnection(id)
  if (!conn) throw new Error('Connection not found')
  if (!canManageLlmConnection(conn, caller)) throw new Error('Forbidden')
  await adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION).doc(id).update({
    status: 'revoked',
    credentialsEnc: null,
    updatedAt: FieldValue.serverTimestamp(),
  })
  const { enqueueCredentialRevocations } = await import('./linked-delivery')
  const { revokeConnectionLlmCredentialBindings } = await import('./bindings')
  await enqueueCredentialRevocations(conn)
  await revokeConnectionLlmCredentialBindings(id)
  const updated = await getLlmProviderConnection(id)
  return maskLlmConnection(updated as LlmProviderConnection)
}

export async function markLlmConnectionSynced(
  id: string,
  agentIds: string[],
): Promise<void> {
  await adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION).doc(id).update({
    status: 'connected',
    syncedAgentIds: agentIds,
    lastSyncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastError: null,
  })
}

/** Delivery was accepted by linked runtimes; per-profile bindings carry completion state. */
export async function markLlmConnectionSyncQueued(id: string): Promise<void> {
  await adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION).doc(id).update({
    status: 'connected',
    syncedAgentIds: [],
    lastSyncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastError: null,
  })
}

/** A machine/profile delivery failure does not prove the saved account is invalid. */
export async function markLlmConnectionSyncWarning(id: string, error: string): Promise<void> {
  await adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION).doc(id).update({
    lastError: error.slice(0, 500),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

export async function markLlmConnectionError(id: string, error: string): Promise<void> {
  await adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION).doc(id).update({
    lastError: error.slice(0, 500),
    status: 'invalid',
    updatedAt: FieldValue.serverTimestamp(),
  })
}

export async function getDecryptedLlmCredentials(
  conn: LlmProviderConnection,
): Promise<LlmConnectionCredentials | null> {
  if (!conn.credentialsEnc) return null
  const { decryptLlmCredentials } = await import('./crypto')
  return decryptLlmCredentials(conn.credentialsEnc, conn.scopeKeyRef)
}
