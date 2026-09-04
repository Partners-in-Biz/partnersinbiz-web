import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { putDeviceGrant } from '@/lib/linked-computers/store'
import { linkedDeviceOwnerType } from '@/lib/linked-computers/policy'
import type { LinkedDevice, LinkedDeviceGrant } from '@/lib/linked-computers/types'
import { getOrgTeam } from '@/lib/org-teams/store'
import { writeLlmCredentialAudit } from './audit'
import {
  listConnectionLlmCredentialBindings,
  putDesiredLlmCredentialBinding,
} from './bindings'
import {
  enqueueCredentialDelivery,
  enqueueCredentialRevocationsForBindings,
} from './linked-delivery'
import { resolveOrgShareLinkedComputerTargets } from './sync-targets'
import {
  LLM_CREDENTIAL_BINDINGS_COLLECTION,
  LLM_PROVIDER_CONNECTIONS_COLLECTION,
  normalizeLlmShareTargets,
  type LlmCredentialBinding,
  type LlmProviderConnection,
} from './types'

const STALE_REVOKE_PENDING_MS = 24 * 60 * 60 * 1000
const ROTATE_RECOMMENDED_ERROR = 'Revocation not acknowledged for 24h. Rotate this key.'

function timestampMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis()
  }
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate(): Date }).toDate().getTime()
  }
  const parsed = typeof value === 'string' ? Date.parse(value) : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function listOrgScopeConnections(orgId: string): Promise<LlmProviderConnection[]> {
  const snap = await adminDb
    .collection(LLM_PROVIDER_CONNECTIONS_COLLECTION)
    .where('scope', '==', 'org')
    .where('orgId', '==', orgId)
    .get()
  return snap.docs
    .map((doc) => ({ ...(doc.data() as LlmProviderConnection), id: doc.id }))
    .filter((connection) => connection.status !== 'revoked')
}

async function isUserOwnedShareBinding(binding: LlmCredentialBinding): Promise<boolean> {
  if (!binding.deviceId) return false
  const snap = await adminDb.collection('linked_devices').doc(binding.deviceId).get()
  if (!snap.exists) return true
  const device = { deviceId: binding.deviceId, ...snap.data() } as LinkedDevice
  try {
    return linkedDeviceOwnerType(device) === 'user'
  } catch {
    return true
  }
}

async function deviceOwnedByUser(deviceId: string, userId: string): Promise<boolean> {
  const snap = await adminDb.collection('linked_devices').doc(deviceId).get()
  if (!snap.exists) return false
  const device = snap.data() as LinkedDevice
  return device.ownerUserId === userId
}

async function memberStillCoveredByShare(orgId: string, userId: string): Promise<boolean> {
  const connections = await listOrgScopeConnections(orgId)
  for (const connection of connections) {
    const share = normalizeLlmShareTargets(connection.shareTargets)
    if (share.mode === 'admins') continue
    if (share.mode === 'organization') return true
    if (share.userIds.includes(userId)) return true
    if (share.mode === 'teams') {
      for (const teamId of share.teamIds) {
        const team = await getOrgTeam(orgId, teamId)
        if (team?.status === 'active' && team.memberUserIds.includes(userId)) return true
      }
    }
  }
  return false
}

export async function reconcileShareBindingsForConnection(
  connection: LlmProviderConnection,
  actorUserId: string,
): Promise<{ enqueuedDeliveries: string[]; enqueuedRevocations: string[] }> {
  if (connection.scope !== 'org') {
    return { enqueuedDeliveries: [], enqueuedRevocations: [] }
  }

  const desired = await resolveOrgShareLinkedComputerTargets({ connection })
  const desiredKeys = new Set(
    desired.targets
      .filter((target) => target.deviceId)
      .map((target) => `${target.deviceId}:${target.agentId}`),
  )

  const existing = (await listConnectionLlmCredentialBindings(connection.id))
    .filter((binding) => binding.deviceId && binding.status !== 'revoked')
  const shareBindings: LlmCredentialBinding[] = []
  for (const binding of existing) {
    if (await isUserOwnedShareBinding(binding)) shareBindings.push(binding)
  }

  const extra = shareBindings.filter((binding) => !desiredKeys.has(`${binding.deviceId}:${binding.agentId}`))
  const existingKeys = new Set(shareBindings.map((binding) => `${binding.deviceId}:${binding.agentId}`))
  const missing = desired.targets.filter((target) => (
    target.deviceId && !existingKeys.has(`${target.deviceId}:${target.agentId}`)
  ))

  const enqueuedRevocations = extra.length
    ? await enqueueCredentialRevocationsForBindings(connection, extra, 'share_targets_narrowed')
    : []

  const enqueuedDeliveries: string[] = []
  for (const target of missing) {
    const binding = await putDesiredLlmCredentialBinding({ connection, target })
    const delivery = await enqueueCredentialDelivery({
      connection,
      bindingId: binding.id,
      target,
    })
    enqueuedDeliveries.push(delivery.jobId)
  }

  await writeLlmCredentialAudit({
    action: 'share_targets.changed',
    connectionId: connection.id,
    orgId: connection.orgId,
    actorUserId,
  })

  return { enqueuedDeliveries, enqueuedRevocations }
}

export async function revokeMemberShareAccess(input: {
  orgId: string
  userId: string
  reason: 'member_removed' | 'team_removed'
}): Promise<{ bindingIds: string[] }> {
  const connections = await listOrgScopeConnections(input.orgId)
  const bindingIds: string[] = []
  for (const connection of connections) {
    const bindings = (await listConnectionLlmCredentialBindings(connection.id))
      .filter((binding) => binding.deviceId && binding.status !== 'revoked')
    const memberBindings: LlmCredentialBinding[] = []
    for (const binding of bindings) {
      if (!binding.deviceId) continue
      if (await deviceOwnedByUser(binding.deviceId, input.userId)) {
        memberBindings.push(binding)
      }
    }
    if (!memberBindings.length) continue
    await enqueueCredentialRevocationsForBindings(connection, memberBindings, input.reason)
    bindingIds.push(...memberBindings.map((binding) => binding.id))
  }
  return { bindingIds }
}

export async function revokeShareBindingsForTeam(input: {
  orgId: string
  teamId: string
  formerMemberUserIds: string[]
  actorUserId: string
}): Promise<{ grantIds: string[]; bindingIds: string[] }> {
  const grantSnap = await adminDb
    .collection('linked_device_grants')
    .where('orgId', '==', input.orgId)
    .where('accessMode', '==', 'teams')
    .get()

  const grantIds: string[] = []
  for (const doc of grantSnap.docs) {
    const grant = { ...(doc.data() as LinkedDeviceGrant) }
    const allowedTeamIds = Array.isArray(grant.allowedTeamIds) ? grant.allowedTeamIds : []
    if (grant.status === 'revoked' || !allowedTeamIds.includes(input.teamId)) continue
    const nextTeamIds = allowedTeamIds.filter((teamId) => teamId !== input.teamId)
    const nextUserIds = Array.isArray(grant.allowedUserIds) ? grant.allowedUserIds : []
    try {
      if (nextTeamIds.length === 0 && nextUserIds.length === 0) {
        await putDeviceGrant({
          deviceId: grant.deviceId,
          orgId: input.orgId,
          actorUserId: input.actorUserId,
          status: 'revoked',
          capabilities: grant.capabilities?.length
            ? grant.capabilities
            : ['workspace.execute', 'workspace.sync'],
          accessMode: 'teams',
          allowedUserIds: nextUserIds,
          allowedTeamIds: nextTeamIds,
        })
      } else {
        await adminDb.collection('linked_device_grants').doc(doc.id).update({
          allowedTeamIds: nextTeamIds,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      grantIds.push(doc.id)
    } catch (error) {
      console.error('[llm-share-team-grant]', doc.id, error)
    }
  }

  const bindingIds: string[] = []
  for (const userId of input.formerMemberUserIds) {
    if (await memberStillCoveredByShare(input.orgId, userId)) continue
    const revoked = await revokeMemberShareAccess({
      orgId: input.orgId,
      userId,
      reason: 'team_removed',
    })
    bindingIds.push(...revoked.bindingIds)
  }

  return { grantIds, bindingIds }
}

export async function revokeShareBindingsForDevice(input: {
  orgId: string
  deviceId: string
  reason: 'grant_paused' | 'grant_revoked' | 'device_revoked'
}): Promise<{ bindingIds: string[] }> {
  const connections = await listOrgScopeConnections(input.orgId)
  const bindingIds: string[] = []
  for (const connection of connections) {
    const bindings = (await listConnectionLlmCredentialBindings(connection.id))
      .filter((binding) => binding.deviceId === input.deviceId && binding.status !== 'revoked')
    if (!bindings.length) continue
    await enqueueCredentialRevocationsForBindings(connection, bindings, input.reason)
    bindingIds.push(...bindings.map((binding) => binding.id))
  }
  return { bindingIds }
}

export type FlagStaleRevokePendingDeps = {
  nowMs?: number
  listPending?: () => Promise<LlmCredentialBinding[]>
  updateBinding?: (id: string, update: Record<string, unknown>) => Promise<void>
  updateConnection?: (id: string, update: Record<string, unknown>) => Promise<void>
  writeAudit?: typeof writeLlmCredentialAudit
}

export async function flagStaleRevokePending(
  deps: FlagStaleRevokePendingDeps = {},
): Promise<{ flagged: number }> {
  const nowMs = deps.nowMs ?? Date.now()
  const cutoff = nowMs - STALE_REVOKE_PENDING_MS
  const writeAudit = deps.writeAudit ?? writeLlmCredentialAudit

  const pending = deps.listPending
    ? await deps.listPending()
    : (await adminDb
      .collection(LLM_CREDENTIAL_BINDINGS_COLLECTION)
      .where('status', '==', 'revoke_pending')
      .get())
      .docs.map((doc) => ({ ...(doc.data() as LlmCredentialBinding), id: doc.id }))

  let flagged = 0
  for (const binding of pending) {
    if (binding.staleFlaggedAt) continue
    if (timestampMillis(binding.updatedAt) > cutoff) continue

    if (deps.updateBinding) {
      await deps.updateBinding(binding.id, {
        lastError: ROTATE_RECOMMENDED_ERROR,
        staleFlaggedAt: nowMs,
      })
    } else {
      await adminDb.collection(LLM_CREDENTIAL_BINDINGS_COLLECTION).doc(binding.id).update({
        lastError: ROTATE_RECOMMENDED_ERROR,
        staleFlaggedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    const connectionUpdate = {
      lastError: ROTATE_RECOMMENDED_ERROR,
      'meta.rotateRecommended': true,
    }
    if (deps.updateConnection) {
      await deps.updateConnection(binding.connectionId, connectionUpdate)
    } else {
      await adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION).doc(binding.connectionId).update({
        ...connectionUpdate,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    await writeAudit({
      action: 'binding.revoke_stale',
      connectionId: binding.connectionId,
      bindingId: binding.id,
      orgId: binding.orgId,
      actorUserId: 'system',
      deviceId: binding.deviceId ?? undefined,
      agentId: binding.agentId,
      reason: 'revoke_pending_stale',
    })
    flagged += 1
  }

  return { flagged }
}
