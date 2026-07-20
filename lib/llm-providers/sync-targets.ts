/**
 * Resolve where organisation LLM credentials may be written.
 * Personal ("user") connections never sync — they stay on linked computers.
 */
import { adminDb } from '@/lib/firebase/admin'
import { getHermesProfileLink } from '@/lib/hermes/server'
import type { HermesProfileLink } from '@/lib/hermes/types'
import type { AgentId } from '@/lib/agents/types'
import type { LinkedDevice } from '@/lib/linked-computers/types'

export type LlmSyncTargetKind = 'org_hermes_link' | 'org_linked_vps'

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

function asLinkedDevice(id: string, data: Record<string, unknown> | undefined): LinkedDevice | null {
  if (!data) return null
  return { ...(data as unknown as LinkedDevice), deviceId: id }
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

    const agentIds = Array.isArray(device.availableAgentIds)
      ? device.availableAgentIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
      : []
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
        ? 'No organisation VPS is linked yet. Link an organisation-owned VPS under Linked Computers, or ask an admin to attach a Hermes profile link for this organisation. Personal credentials stay on each user’s linked computer and are never synced here.'
        : 'Organisation VPS is linked but no Hermes agent profiles are available to sync. Wait until the VPS reports healthy agents, then try Sync again.',
    }
  }

  return { targets, orgVpsDeviceCount, hasHermesProfileLink }
}
