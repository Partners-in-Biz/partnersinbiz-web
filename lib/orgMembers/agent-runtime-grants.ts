import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import {
  normalizeMemberAccessPolicy,
  runtimeGrantKeys,
  type MemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'

export type CreateAgentAccessMode = 'personal' | 'organization' | 'people'

export function resolveCreatedAgentAccess(input: {
  deviceAccessScope: 'personal' | 'organization'
  requested?: CreateAgentAccessMode | null
}): { accessScope: 'personal' | 'organization'; grantMembers: boolean } {
  const requested = input.requested === 'organization' || input.requested === 'people' || input.requested === 'personal'
    ? input.requested
    : input.deviceAccessScope === 'organization' ? 'organization' : 'personal'
  if (input.deviceAccessScope === 'organization') {
    return { accessScope: 'organization', grantMembers: requested === 'people' }
  }
  if (requested === 'personal') return { accessScope: 'personal', grantMembers: false }
  return { accessScope: 'organization', grantMembers: requested === 'people' }
}

export function withGrantedAgentOnRuntime(
  policyValue: MemberAccessPolicy | unknown,
  runtimeTargetId: string,
  agentId: AgentId,
): MemberAccessPolicy {
  const policy = normalizeMemberAccessPolicy(policyValue)
  const keys = runtimeGrantKeys(runtimeTargetId)
  if (keys.length === 0 || !isValidAgentId(agentId)) return policy
  const agentRuntimeAccess = { ...policy.agentRuntimeAccess }
  for (const key of keys) {
    const current = agentRuntimeAccess[key] ?? []
    if (current.includes(agentId)) continue
    agentRuntimeAccess[key] = [...current, agentId]
  }
  return { ...policy, preset: 'custom', agentRuntimeAccess }
}

export async function grantAgentRuntimeAccessToMembers(input: {
  orgId: string
  runtimeTargetId: string
  agentId: string
  memberUserIds: readonly string[]
  actorUserId: string
}): Promise<string[]> {
  if (!isValidAgentId(input.agentId)) return []
  const granted: string[] = []
  const unique = [...new Set(input.memberUserIds.map((id) => id.trim()).filter(Boolean))]
  for (const memberUserId of unique) {
    if (memberUserId === input.actorUserId) continue
    const ref = adminDb.collection('orgMembers').doc(`${input.orgId}_${memberUserId}`)
    const snap = await ref.get()
    if (!snap.exists) continue
    const row = snap.data() ?? {}
    if (row.orgId && row.orgId !== input.orgId) continue
    const next = withGrantedAgentOnRuntime(row.accessPolicy, input.runtimeTargetId, input.agentId)
    await ref.update({
      accessPolicy: next,
      updatedAt: FieldValue.serverTimestamp(),
    })
    granted.push(memberUserId)
  }
  return granted
}

export function parseSharedMemberUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((id) => typeof id === 'string' ? id.trim() : '').filter(Boolean))]
}
