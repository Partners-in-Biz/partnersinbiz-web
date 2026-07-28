/**
 * Resolve where LLM credentials may be written.
 * - Org connections → organisation VPS / Hermes profile link only
 * - Personal connections → the owner's linked computers; optionally org VPS when member access allows it
 */
import { adminDb } from '@/lib/firebase/admin'
import { getHermesProfileLink } from '@/lib/hermes/server'
import type { HermesProfileLink } from '@/lib/hermes/types'
import type { AgentId } from '@/lib/agents/types'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import { linkedDeviceOwnerType } from '@/lib/linked-computers/policy'
import {
  memberMayUsePersonalLlmOnOrgVps,
  type MemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'
import type { OrgRole } from '@/lib/organizations/types'

export type LlmSyncTargetKind = 'org_hermes_link' | 'org_linked_vps' | 'user_linked_computer'

export interface LlmSyncTarget {
  kind: LlmSyncTargetKind
  agentId: AgentId
  /** Prefer this agent_dispatch runtime when calling callAgentPath. */
  runtimeTargetId?: string
  deviceId?: string
  label: string
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
    const runtimeTargetId = typeof device.runtimeTargetId === 'string' ? device.runtimeTargetId : undefined

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
 * Personal credentials sync to the owner's active linked computers.
 * When member access allows personal LLM use on the org VPS, also include org VPS targets
 * (caller should skip providers already covered by org-scoped connections).
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
    const runtimeTargetId = typeof device.runtimeTargetId === 'string' ? device.runtimeTargetId : undefined

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

  const allowOrgVps = input.includeOrgVps === true
    || memberMayUsePersonalLlmOnOrgVps(input.accessPolicy, input.orgRole)
  let includedOrgVps = false
  if (allowOrgVps) {
    const orgTargets = await resolveOrgLlmSyncTargets(input.orgId, input.preferredAgentIds)
    for (const target of orgTargets.targets) {
      const key = `${target.kind}:${target.deviceId || 'link'}:${target.agentId}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push(target)
      includedOrgVps = true
    }
  }

  if (!targets.length) {
    return {
      targets: [],
      linkedComputerCount,
      includedOrgVps: false,
      reasonIfEmpty: linkedComputerCount === 0
        ? 'No linked computers with healthy Hermes agents were found for your account. Pair a computer under Linked Computers, wait until agents appear online, then sync again.'
        : allowOrgVps
          ? 'Your linked computers and organisation VPS have no Hermes agent profiles available to sync yet.'
          : 'Your linked computers have no Hermes agent profiles available to sync yet. Ask an admin to enable personal LLM credentials on the organisation VPS if you need to sync there.',
    }
  }

  return { targets, linkedComputerCount, includedOrgVps }
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
    if (device.deviceKind === 'vps') continue
    if (device.runtimeTargetId === runtimeTarget || device.deviceId === runtimeTarget) return true
  }
  return false
}
