/**
 * Resolve where LLM credentials may be written.
 * - Org connections → organisation VPS / Hermes profile link, plus member machines when shareTargets allow
 * - Personal connections → the owner's linked computers only
 */
import { adminDb } from '@/lib/firebase/admin'
import { getHermesProfileLink } from '@/lib/hermes/server'
import type { HermesProfileLink } from '@/lib/hermes/types'
import type { AgentId } from '@/lib/agents/types'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import { isActiveOrgMembershipRow, linkedDeviceOwnerType } from '@/lib/linked-computers/policy'
import { memberCanUseAgentOnRuntime, type MemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import { loadOrgMemberAccessPolicy } from '@/lib/orgMembers/org-access-policy'
import type { OrgRole } from '@/lib/organizations/types'
import { normalizeLlmShareTargets, type LlmProviderConnection, type LlmShareTargets } from './types'

export type LlmSyncTargetKind = 'org_hermes_link' | 'org_linked_vps' | 'user_linked_computer' | 'member_linked_computer'

export interface LlmSyncTarget {
  kind: LlmSyncTargetKind
  agentId: AgentId
  /** Prefer this agent_dispatch runtime when calling callAgentPath. */
  runtimeTargetId?: string
  deviceId?: string
  label: string
  /** User who owns the member machine. Set only for member_linked_computer. */
  memberUserId?: string
  /** When set, push via callHermesJson against this org profile link. */
  hermesLink?: HermesProfileLink
}

export interface ResolveOrgLlmSyncTargetsResult {
  targets: LlmSyncTarget[]
  orgVpsDeviceCount: number
  hasHermesProfileLink: boolean
  reasonIfEmpty?: string
}

export interface ResolveUserLlmSyncTargetsResult {
  targets: LlmSyncTarget[]
  linkedComputerCount: number
  includedOrgVps: boolean
  reasonIfEmpty?: string
}

function asLinkedDevice(id: string, data: Record<string, unknown> | undefined): LinkedDevice | null {
  if (!data) return null
  return { ...(data as unknown as LinkedDevice), deviceId: id }
}

function agentIdsFromDevice(device: LinkedDevice): string[] {
  return Array.isArray(device.availableAgentIds)
    ? device.availableAgentIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    : []
}

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

/** Resolve a public runtime selector to the physical credential-binding target. */
export async function resolveLlmCredentialRuntimeTarget(input: {
  runtimeTargetId?: string | null
  orgId: string
  ownerUid: string
  agentId: string
}): Promise<{ runtimeTargetId: string; deviceId: string | null; ownerType: 'organization' | 'user' | null }> {
  const requested = input.runtimeTargetId?.trim() || 'vps'
  const snapshots = await adminDb.collection('linked_devices').get()
  const devices = snapshots.docs
    .map((doc) => asLinkedDevice(doc.id, doc.data() as Record<string, unknown>))
    .filter((device): device is LinkedDevice => Boolean(
      device
      && device.status === 'active'
      && agentIdsFromDevice(device).includes(input.agentId),
    ))
    .sort((left, right) => timestampMillis(right.lastSeenAt) - timestampMillis(left.lastSeenAt))

  const exact = devices.find((device) => (
    device.deviceId === requested || device.runtimeTargetId === requested
  ))
  if (exact) {
    const ownerType = linkedDeviceOwnerType(exact)
    return {
      runtimeTargetId: exact.runtimeTargetId,
      deviceId: exact.deviceId,
      ownerType: ownerType === 'organization' ? 'organization' : 'user',
    }
  }

  if (requested === 'local') {
    const personal = devices.find((device) => (
      linkedDeviceOwnerType(device) === 'user' && device.ownerUserId === input.ownerUid
    ))
    return personal
      ? { runtimeTargetId: personal.runtimeTargetId, deviceId: personal.deviceId, ownerType: 'user' }
      : { runtimeTargetId: requested, deviceId: null, ownerType: null }
  }

  if (requested === 'vps' || requested === 'auto') {
    const shared = devices.find((device) => (
      device.deviceKind === 'vps'
      && linkedDeviceOwnerType(device) === 'organization'
      && device.ownerOrgId === input.orgId
    ))
    return shared
      ? { runtimeTargetId: shared.runtimeTargetId, deviceId: shared.deviceId, ownerType: 'organization' }
      : { runtimeTargetId: 'vps', deviceId: null, ownerType: 'organization' }
  }

  return { runtimeTargetId: requested, deviceId: null, ownerType: null }
}

export async function resolveOrgLlmSyncTargets(
  orgId: string,
  preferredAgentIds?: string[],
): Promise<ResolveOrgLlmSyncTargetsResult> {
  const preferred = new Set((preferredAgentIds ?? []).filter(Boolean))
  const targets: LlmSyncTarget[] = []
  const seen = new Set<string>()

  const link = await getHermesProfileLink(orgId)
  const hasHermesProfileLink = Boolean(link?.enabled && link.baseUrl && link.apiKey && link.profile)
  if (hasHermesProfileLink && link) {
    if (!preferred.size || preferred.has(link.profile)) {
      const key = `link:${link.profile}`
      if (!seen.has(key)) {
        seen.add(key)
        targets.push({
          kind: 'org_hermes_link',
          agentId: link.profile as AgentId,
          label: `Organisation Hermes · ${link.profile}`,
          hermesLink: link,
        })
      }
    }
  }

  const deviceSnap = await adminDb
    .collection('linked_devices')
    .where('ownerOrgId', '==', orgId)
    .get()

  let orgVpsDeviceCount = 0
  for (const doc of deviceSnap.docs) {
    const device = asLinkedDevice(doc.id, doc.data() as Record<string, unknown>)
    if (!device) continue
    if (device.deviceKind !== 'vps') continue
    if (device.status !== 'active') continue
    if (device.ownerType !== 'organization' && device.ownerOrgId !== orgId) continue
    orgVpsDeviceCount += 1

    const agentIds = agentIdsFromDevice(device)
    const runtimeTargetId = typeof device.runtimeTargetId === 'string' && device.runtimeTargetId
      ? device.runtimeTargetId
      : `linked-device:${device.deviceId}`

    for (const agentId of agentIds.slice(0, 24)) {
      if (preferred.size && !preferred.has(agentId)) continue
      const key = `vps:${device.deviceId}:${agentId}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({
        kind: 'org_linked_vps',
        agentId: agentId as AgentId,
        runtimeTargetId,
        deviceId: device.deviceId,
        label: `${device.label || 'Org VPS'} · ${agentId}`,
      })
    }
  }

  // A linked VPS supersedes the older one-profile admin sidecar link for the
  // same profile. Delivering to both creates a duplicate Pip binding and lets
  // stale legacy-sidecar errors obscure the real fleet result.
  const linkedVpsAgentIds = new Set(
    targets
      .filter((target) => target.kind === 'org_linked_vps')
      .map((target) => target.agentId),
  )
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index]
    if (target.kind === 'org_hermes_link' && linkedVpsAgentIds.has(target.agentId)) {
      targets.splice(index, 1)
    }
  }

  if (!targets.length) {
    return {
      targets: [],
      orgVpsDeviceCount,
      hasHermesProfileLink,
      reasonIfEmpty: orgVpsDeviceCount === 0 && !hasHermesProfileLink
        ? 'No organisation VPS is linked yet. Link an organisation-owned VPS under Linked Computers, or ask an admin to attach a Hermes profile link for this organisation.'
        : 'Organisation VPS is linked but no Hermes agent profiles are available to sync. Wait until the VPS reports healthy agents, then try Sync again.',
    }
  }

  return { targets, orgVpsDeviceCount, hasHermesProfileLink }
}

/**
 * Personal credentials sync to the owner's active linked computers only.
 * Personal secrets are never copied onto an organisation-owned runtime.
 */
export async function resolveUserLlmSyncTargets(input: {
  ownerUid: string
  orgId: string
  accessPolicy?: MemberAccessPolicy | null
  orgRole?: OrgRole | 'system' | null
  preferredAgentIds?: string[]
  includeOrgVps?: boolean
}): Promise<ResolveUserLlmSyncTargetsResult> {
  const preferred = new Set((input.preferredAgentIds ?? []).filter(Boolean))
  const targets: LlmSyncTarget[] = []
  const seen = new Set<string>()
  let linkedComputerCount = 0

  const deviceSnap = await adminDb
    .collection('linked_devices')
    .where('ownerUserId', '==', input.ownerUid)
    .get()

  for (const doc of deviceSnap.docs) {
    const device = asLinkedDevice(doc.id, doc.data() as Record<string, unknown>)
    if (!device) continue
    if (device.status !== 'active') continue
    if (linkedDeviceOwnerType(device) !== 'user') continue
    // Personal sync targets are devices owned by the member. This includes a
    // member-owned VPS; organisation-owned VPS credentials remain separately
    // controlled by the organisation access policy below.

    linkedComputerCount += 1
    const agentIds = agentIdsFromDevice(device)
    const runtimeTargetId = typeof device.runtimeTargetId === 'string' && device.runtimeTargetId
      ? device.runtimeTargetId
      : `linked-device:${device.deviceId}`

    for (const agentId of agentIds.slice(0, 24)) {
      if (preferred.size && !preferred.has(agentId)) continue
      const key = `computer:${device.deviceId}:${agentId}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({
        kind: 'user_linked_computer',
        agentId: agentId as AgentId,
        runtimeTargetId,
        deviceId: device.deviceId,
        label: `${device.label || 'Linked computer'} · ${agentId}`,
      })
    }
  }

  if (!targets.length) {
    return {
      targets: [],
      linkedComputerCount,
      includedOrgVps: false,
      reasonIfEmpty: linkedComputerCount === 0
        ? 'No linked computers with healthy Hermes agents were found for your account. Pair a computer under Linked Computers, wait until agents appear online, then sync again.'
        : 'Your linked computers have no Hermes agent profiles available to sync yet.',
    }
  }

  return { targets, linkedComputerCount, includedOrgVps: false }
}

/** True when the conversation runtime is the organisation VPS (shared). */
export function isOrgVpsConversationRuntime(runtimeTarget: string | null | undefined): boolean {
  if (!runtimeTarget || runtimeTarget === 'vps' || runtimeTarget === 'auto') return true
  if (runtimeTarget === 'local') return false
  return false
}

/**
 * Classify whether a runtime target id belongs to one of the caller's linked computers.
 * Falls back to treating unknown non-vps/local ids as linked-computer candidates when listed.
 */
export async function runtimeBelongsToUserComputer(
  ownerUid: string,
  runtimeTarget: string | null | undefined,
): Promise<boolean> {
  if (!runtimeTarget || runtimeTarget === 'vps' || runtimeTarget === 'auto') return false
  if (runtimeTarget === 'local') return true

  const snap = await adminDb
    .collection('linked_devices')
    .where('ownerUserId', '==', ownerUid)
    .get()

  for (const doc of snap.docs) {
    const device = asLinkedDevice(doc.id, doc.data() as Record<string, unknown>)
    if (!device || device.status !== 'active') continue
    if (linkedDeviceOwnerType(device) !== 'user') continue
    if (device.runtimeTargetId === runtimeTarget || device.deviceId === runtimeTarget) return true
  }
  return false
}

function membershipUserId(row: Record<string, unknown> | undefined, fallbackId?: string): string | null {
  if (typeof row?.uid === 'string' && row.uid.trim()) return row.uid.trim()
  if (typeof row?.userId === 'string' && row.userId.trim()) return row.userId.trim()
  return fallbackId?.trim() || null
}

function orgManagedAgents(device: LinkedDevice, orgId: string): Array<{ orgId: string; agentId: string; profile: string; healthy: boolean }> {
  if (!Array.isArray(device.availableAgents)) return []
  return device.availableAgents.filter((entry): entry is { orgId: string; agentId: string; profile: string; healthy: boolean } => (
    Boolean(entry)
    && typeof entry.orgId === 'string'
    && typeof entry.agentId === 'string'
    && typeof entry.profile === 'string'
    && entry.healthy === true
    && entry.orgId === orgId
  ))
}

async function listActiveShareMemberIds(orgId: string, share: LlmShareTargets): Promise<string[]> {
  const candidates = new Set<string>()

  if (share.mode === 'organization') {
    const snap = await adminDb.collection('orgMembers').where('orgId', '==', orgId).get()
    for (const doc of snap.docs) {
      const row = doc.data() as Record<string, unknown>
      if (!isActiveOrgMembershipRow(row)) continue
      const uid = membershipUserId(row, doc.id.startsWith(`${orgId}_`) ? doc.id.slice(orgId.length + 1) : undefined)
      if (uid) candidates.add(uid)
    }
  } else if (share.mode === 'teams') {
    for (const teamId of share.teamIds) {
      const snap = await adminDb.collection('org_teams').doc(teamId).get()
      if (!snap.exists) continue
      const team = snap.data() as Record<string, unknown> | undefined
      if (!team || team.orgId !== orgId || team.status !== 'active') continue
      const memberUserIds = Array.isArray(team.memberUserIds) ? team.memberUserIds : []
      for (const uid of memberUserIds) {
        if (typeof uid === 'string' && uid.trim()) candidates.add(uid.trim())
      }
    }
    for (const uid of share.userIds) candidates.add(uid)
  } else if (share.mode === 'selected_users') {
    for (const uid of share.userIds) candidates.add(uid)
  }

  const active: string[] = []
  for (const uid of candidates) {
    const snap = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
    if (!snap.exists) continue
    const row = snap.data() as Record<string, unknown>
    if (!isActiveOrgMembershipRow(row)) continue
    if (typeof row.orgId === 'string' && row.orgId && row.orgId !== orgId) continue
    active.push(uid)
  }
  return active
}

async function memberMayUseSharedAgent(
  orgId: string,
  uid: string,
  runtimeTargetId: string | undefined,
  agentId: string,
): Promise<boolean> {
  const policy = await loadOrgMemberAccessPolicy(orgId, uid)
  if (!policy) return false
  return memberCanUseAgentOnRuntime(policy, runtimeTargetId, agentId as AgentId)
}

/**
 * Safety property: org keys are derived only from `availableAgents` whose orgId
 * matches; never from legacy `availableAgentIds`.
 */
export async function resolveOrgShareLinkedComputerTargets(input: {
  connection: Pick<LlmProviderConnection, 'orgId' | 'shareTargets'>
  preferredAgentIds?: string[]
}): Promise<{ targets: LlmSyncTarget[]; memberCount: number; reasonIfEmpty?: string }> {
  const share = normalizeLlmShareTargets(input.connection.shareTargets)
  if (share.mode === 'admins') return { targets: [], memberCount: 0 }

  const orgId = input.connection.orgId
  const preferred = new Set((input.preferredAgentIds ?? []).filter(Boolean))
  const memberIds = await listActiveShareMemberIds(orgId, share)
  const targets: LlmSyncTarget[] = []
  const seen = new Set<string>()

  for (const uid of memberIds) {
    const deviceSnap = await adminDb.collection('linked_devices').where('ownerUserId', '==', uid).get()
    for (const doc of deviceSnap.docs) {
      const device = asLinkedDevice(doc.id, doc.data() as Record<string, unknown>)
      if (!device || device.status !== 'active') continue
      try {
        if (linkedDeviceOwnerType(device) !== 'user') continue
      } catch {
        continue
      }

      const grantSnap = await adminDb.collection('linked_device_grants').doc(`${orgId}_${device.deviceId}`).get()
      if (!grantSnap.exists || grantSnap.data()?.status !== 'active') continue

      const runtimeTargetId = typeof device.runtimeTargetId === 'string' && device.runtimeTargetId
        ? device.runtimeTargetId
        : `linked-device:${device.deviceId}`

      for (const entry of orgManagedAgents(device, orgId)) {
        if (share.agentIds.length && !share.agentIds.includes(entry.agentId)) continue
        if (preferred.size && !preferred.has(entry.agentId)) continue
        if (!await memberMayUseSharedAgent(orgId, uid, runtimeTargetId, entry.agentId)) continue

        const key = `${device.deviceId}:${entry.profile}`
        if (seen.has(key)) continue
        seen.add(key)
        targets.push({
          kind: 'member_linked_computer',
          agentId: entry.profile as AgentId,
          runtimeTargetId,
          deviceId: device.deviceId,
          label: `${device.label || 'Linked computer'} · ${entry.profile}`,
          memberUserId: uid,
        })
      }
    }
  }

  if (!targets.length) {
    return {
      targets: [],
      memberCount: memberIds.length,
      reasonIfEmpty: memberIds.length === 0
        ? 'No eligible members for this organisation key share.'
        : 'No member machines with an active grant and a matching organisation profile are available yet.',
    }
  }

  return { targets, memberCount: memberIds.length }
}

export async function orgShareAllowsDevice(input: {
  connection: Pick<LlmProviderConnection, 'orgId' | 'shareTargets'>
  device: LinkedDevice
  profile: string
}): Promise<boolean> {
  const share = normalizeLlmShareTargets(input.connection.shareTargets)
  if (share.mode === 'admins') return false

  const orgId = input.connection.orgId
  const device = input.device
  if (device.status !== 'active') return false
  try {
    if (linkedDeviceOwnerType(device) !== 'user') return false
  } catch {
    return false
  }
  const uid = typeof device.ownerUserId === 'string' ? device.ownerUserId : ''
  if (!uid) return false

  const members = await listActiveShareMemberIds(orgId, share)
  if (!members.includes(uid)) return false

  const grantSnap = await adminDb.collection('linked_device_grants').doc(`${orgId}_${device.deviceId}`).get()
  if (!grantSnap.exists || grantSnap.data()?.status !== 'active') return false

  const entry = orgManagedAgents(device, orgId).find((item) => item.profile === input.profile)
  if (!entry) return false
  if (share.agentIds.length && !share.agentIds.includes(entry.agentId)) return false

  const runtimeTargetId = typeof device.runtimeTargetId === 'string' && device.runtimeTargetId
    ? device.runtimeTargetId
    : `linked-device:${device.deviceId}`
  return memberMayUseSharedAgent(orgId, uid, runtimeTargetId, entry.agentId)
}
