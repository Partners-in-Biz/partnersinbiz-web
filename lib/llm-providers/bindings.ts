import crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  LLM_CREDENTIAL_BINDINGS_COLLECTION,
  LLM_PROVIDER_CONNECTIONS_COLLECTION,
  type LlmCredentialBinding,
  type LlmCredentialBindingStatus,
  type LlmProviderConnection,
} from './types'
import type { LlmSyncTarget } from './sync-targets'

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function canonicalLlmRuntimeTargetId(value: string | null | undefined): string {
  const target = clean(value)
  return target && target !== 'auto' ? target : 'vps'
}

export function llmCredentialBindingId(input: {
  connectionId: string
  runtimeTargetId?: string | null
  deviceId?: string | null
  agentId: string
}): string {
  return crypto.createHash('sha256')
    .update([
      'pib-llm-credential-binding:v1',
      input.connectionId,
      canonicalLlmRuntimeTargetId(input.runtimeTargetId),
      clean(input.deviceId),
      input.agentId,
    ].join('\n'))
    .digest('hex')
    .slice(0, 40)
}

export function connectionCredentialVersion(connection: Pick<LlmProviderConnection, 'credentialVersion'>): number {
  const version = Number(connection.credentialVersion)
  return Number.isInteger(version) && version > 0 ? version : 1
}

export async function putDesiredLlmCredentialBinding(input: {
  connection: LlmProviderConnection
  target: LlmSyncTarget
}): Promise<LlmCredentialBinding> {
  const runtimeTargetId = canonicalLlmRuntimeTargetId(input.target.runtimeTargetId)
  const id = llmCredentialBindingId({
    connectionId: input.connection.id,
    runtimeTargetId,
    deviceId: input.target.deviceId,
    agentId: input.target.agentId,
  })
  const ref = adminDb.collection(LLM_CREDENTIAL_BINDINGS_COLLECTION).doc(id)
  const existing = await ref.get()
  const row = existing.data() as Partial<LlmCredentialBinding> | undefined
  const credentialVersion = connectionCredentialVersion(input.connection)
  const preserveReady = row?.status === 'ready'
    && row.credentialVersion === credentialVersion
    && row.liveAuthVerified === true
  const binding: Omit<LlmCredentialBinding, 'createdAt' | 'updatedAt'> = {
    id,
    connectionId: input.connection.id,
    credentialVersion,
    orgId: input.connection.orgId,
    ownerUid: input.connection.ownerUid,
    scope: input.connection.scope,
    provider: input.connection.provider,
    hermesProvider: input.connection.hermesProvider,
    runtimeTargetId,
    deviceId: input.target.deviceId ?? null,
    machineLabel: input.target.label,
    agentId: input.target.agentId,
    status: preserveReady ? 'ready' : 'desired',
    liveAuthVerified: preserveReady,
    verifiedModelIds: preserveReady && Array.isArray(row?.verifiedModelIds)
      ? row.verifiedModelIds.filter((value): value is string => typeof value === 'string')
      : [],
    lastError: preserveReady ? null : null,
    deliveryJobId: preserveReady ? row?.deliveryJobId ?? null : null,
    lastVerifiedAt: preserveReady ? row?.lastVerifiedAt ?? null : null,
  }
  await ref.set({
    ...binding,
    createdAt: existing.exists ? row?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: false })
  const saved = await ref.get()
  return { ...(saved.data() as LlmCredentialBinding), id }
}

export async function updateLlmCredentialBinding(
  id: string,
  update: {
    status: LlmCredentialBindingStatus
    liveAuthVerified?: boolean
    verifiedModelIds?: string[]
    lastError?: string | null
    deliveryJobId?: string | null
  },
): Promise<void> {
  await adminDb.collection(LLM_CREDENTIAL_BINDINGS_COLLECTION).doc(id).update({
    status: update.status,
    ...(typeof update.liveAuthVerified === 'boolean' ? { liveAuthVerified: update.liveAuthVerified } : {}),
    ...(update.verifiedModelIds ? { verifiedModelIds: [...new Set(update.verifiedModelIds)].slice(0, 256) } : {}),
    ...(update.lastError !== undefined ? { lastError: update.lastError?.slice(0, 500) ?? null } : {}),
    ...(update.deliveryJobId !== undefined ? { deliveryJobId: update.deliveryJobId } : {}),
    ...(update.status === 'ready' ? { lastVerifiedAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

export async function listRuntimeLlmCredentialBindings(input: {
  runtimeTargetId?: string | null
  agentId: string
  connectionIds: string[]
}): Promise<LlmCredentialBinding[]> {
  if (!input.connectionIds.length) return []
  const runtimeTargetId = canonicalLlmRuntimeTargetId(input.runtimeTargetId)
  const snapshots = await adminDb.collection(LLM_CREDENTIAL_BINDINGS_COLLECTION)
    .where('runtimeTargetId', '==', runtimeTargetId)
    .get()
  const allowed = new Set(input.connectionIds)
  return snapshots.docs
    .map((doc) => ({ ...(doc.data() as LlmCredentialBinding), id: doc.id }))
    .filter((binding) => binding.agentId === input.agentId && allowed.has(binding.connectionId))
}

export async function requireReadyLlmCredentialBinding(input: {
  bindingId: string
  connectionId: string
  orgId: string
  ownerUid: string
  runtimeTargetId?: string | null
  agentId: string
}): Promise<LlmCredentialBinding> {
  const snapshot = await adminDb.collection(LLM_CREDENTIAL_BINDINGS_COLLECTION).doc(input.bindingId).get()
  if (!snapshot.exists) throw new Error('Selected LLM account is not synced to this machine')
  const binding = { ...(snapshot.data() as LlmCredentialBinding), id: snapshot.id }
  const connectionSnapshot = await adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION)
    .doc(input.connectionId)
    .get()
  const connection = connectionSnapshot.data() as LlmProviderConnection | undefined
  if (binding.connectionId !== input.connectionId
    || binding.orgId !== input.orgId
    || binding.agentId !== input.agentId
    || binding.runtimeTargetId !== canonicalLlmRuntimeTargetId(input.runtimeTargetId)
    || binding.status !== 'ready'
    || binding.liveAuthVerified !== true
    || (binding.scope === 'user' && binding.ownerUid !== input.ownerUid)
    || !connectionSnapshot.exists
    || connection?.status !== 'connected'
    || !connection?.credentialsEnc
    || connectionCredentialVersion(connection) !== binding.credentialVersion) {
    throw new Error('Selected LLM account is not live-ready for this machine and agent profile')
  }
  return binding
}

export async function requireDeliverableLlmCredentialBinding(input: {
  bindingId: string
  connectionId: string
  credentialVersion: number
  deviceId: string
  ownerUid: string | null
  orgId: string
  scope: 'org' | 'user'
  agentId: string
}): Promise<LlmCredentialBinding> {
  const snapshot = await adminDb.collection(LLM_CREDENTIAL_BINDINGS_COLLECTION).doc(input.bindingId).get()
  if (!snapshot.exists) throw new Error('Credential binding not found')
  const binding = { ...(snapshot.data() as LlmCredentialBinding), id: snapshot.id }
  if (binding.connectionId !== input.connectionId
    || binding.credentialVersion !== input.credentialVersion
    || binding.deviceId !== input.deviceId
    || binding.orgId !== input.orgId
    || binding.scope !== input.scope
    || (binding.scope === 'user' && binding.ownerUid !== input.ownerUid)
    || binding.agentId !== input.agentId
    || !['desired', 'delivering', 'stored', 'failed'].includes(binding.status)) {
    throw new Error('Credential binding does not authorize this device and profile')
  }
  return binding
}

/**
 * Verify that an asynchronous receipt still belongs to the exact credential
 * generation it was created for. Unlike delivery authorization this permits
 * every status because revoke receipts can arrive after local state changes.
 */
export async function requireMatchingLlmCredentialBindingGeneration(input: {
  bindingId: string
  connectionId: string
  credentialVersion: number
  deviceId: string
  ownerUid: string | null
  orgId: string
  scope: 'org' | 'user'
  agentId: string
}): Promise<LlmCredentialBinding> {
  const snapshot = await adminDb.collection(LLM_CREDENTIAL_BINDINGS_COLLECTION).doc(input.bindingId).get()
  if (!snapshot.exists) throw new Error('Credential binding not found')
  const binding = { ...(snapshot.data() as LlmCredentialBinding), id: snapshot.id }
  if (binding.connectionId !== input.connectionId
    || binding.credentialVersion !== input.credentialVersion
    || binding.deviceId !== input.deviceId
    || binding.orgId !== input.orgId
    || binding.scope !== input.scope
    || (binding.scope === 'user' && binding.ownerUid !== input.ownerUid)
    || binding.agentId !== input.agentId) {
    throw new Error('Credential binding generation does not match this receipt')
  }
  return binding
}

export async function revokeConnectionLlmCredentialBindings(connectionId: string): Promise<void> {
  const snapshot = await adminDb.collection(LLM_CREDENTIAL_BINDINGS_COLLECTION)
    .where('connectionId', '==', connectionId)
    .get()
  if (snapshot.empty) return
  const batch = adminDb.batch()
  let writes = 0
  for (const doc of snapshot.docs) {
    const status = (doc.data() as LlmCredentialBinding | undefined)?.status
    if (status === 'revoke_pending') continue
    writes += 1
    batch.update(doc.ref, {
      status: 'revoked',
      liveAuthVerified: false,
      verifiedModelIds: [],
      lastError: 'Connection revoked',
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  if (writes === 0) return
  await batch.commit()
}

export async function listConnectionLlmCredentialBindings(connectionId: string): Promise<LlmCredentialBinding[]> {
  const snapshot = await adminDb.collection(LLM_CREDENTIAL_BINDINGS_COLLECTION)
    .where('connectionId', '==', connectionId)
    .get()
  return snapshot.docs.map((doc) => ({ ...(doc.data() as LlmCredentialBinding), id: doc.id }))
}
