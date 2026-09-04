import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { createLinkedAgent } from '@/lib/agents/team'
import type { AgentTeamDoc } from '@/lib/agents/types'
import {
  assertCanCreateAgentOnDevice,
  buildScopedAgentId,
  runtimeSupportsCustomAgentProfiles,
} from '@/lib/agents/org-agent-policy'
import {
  listDeviceDesiredAgents,
  setDeviceDesiredAgents,
} from '@/lib/linked-computers/agent-host-service'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import type { OrgRole } from '@/lib/organizations/types'
import { buildBotComputerBinding } from '@/lib/messages/bot-computer-isolation'
import {
  grantAgentRuntimeAccessToMembers,
  parseSharedMemberUserIds,
  resolveCreatedAgentAccess,
  type CreateAgentAccessMode,
} from '@/lib/orgMembers/agent-runtime-grants'

export async function provisionCustomBotOnDevice(input: {
  orgId: string
  actorUserId: string
  role: OrgRole
  handle: string
  name: string
  roleTitle: string
  persona: string
  defaultModel?: string
  iconKey?: string
  colorKey?: string
  deviceId: string
  accessMode?: CreateAgentAccessMode
  sharedWithUserIds?: unknown
}): Promise<{ agent: AgentTeamDoc; deviceId: string; runtimeTargetId: string; enqueuedJobIds: string[] }> {
  const agentId = buildScopedAgentId(input.orgId, input.handle)
  const deviceRef = adminDb.collection('linked_devices').doc(input.deviceId)
  const deviceDoc = await deviceRef.get()
  if (!deviceDoc.exists) {
    const error = new Error('Computer not found') as Error & { status?: number }
    error.status = 404
    throw error
  }
  const device = { deviceId: input.deviceId, ...deviceDoc.data() } as LinkedDevice
  if (!runtimeSupportsCustomAgentProfiles(device.runtimeVersion)) {
    const error = new Error('Update this linked computer runtime before creating Bots') as Error & { status?: number }
    error.status = 409
    throw error
  }
  const deviceAccessScope = assertCanCreateAgentOnDevice({
    device,
    actorUserId: input.actorUserId,
    orgId: input.orgId,
    role: input.role,
  })
  const createdAccess = resolveCreatedAgentAccess({
    deviceAccessScope,
    requested: input.accessMode,
  })
  const accessScope = createdAccess.accessScope
  const sharedWithUserIds = createdAccess.grantMembers
    ? parseSharedMemberUserIds(input.sharedWithUserIds)
    : []
  const agent = await createLinkedAgent({
    agentId,
    name: input.name,
    role: input.roleTitle,
    persona: input.persona,
    defaultModel: input.defaultModel || 'auto',
    iconKey: input.iconKey || 'smart_toy',
    colorKey: input.colorKey || 'sky',
    scopeOrgId: input.orgId,
    agentHandle: input.handle,
    ownerUserId: accessScope === 'personal' ? input.actorUserId : undefined,
    createdByUserId: input.actorUserId,
    homeDeviceId: input.deviceId,
    accessScope,
    agentKind: 'custom',
  })
  const botComputer = buildBotComputerBinding({
    agentId,
    deviceId: input.deviceId,
    runtimeTarget: device.runtimeTargetId || `linked-device:${input.deviceId}`,
  })
  if (botComputer) {
    await adminDb.collection('agent_team').doc(agentId).update({
      botComputer,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  const inventory = await listDeviceDesiredAgents(input.deviceId)
  const desired = inventory.desiredAgents.map((row) => ({
    agentId: row.agentId,
    keepInSync: row.keepInSync,
  }))
  if (!desired.some((row) => row.agentId === agentId)) {
    desired.push({ agentId, keepInSync: true })
  }
  const sync = await setDeviceDesiredAgents({
    deviceId: input.deviceId,
    actorUserId: input.actorUserId,
    orgId: input.orgId,
    desired,
  })
  const runtimeTargetId = device.runtimeTargetId || `linked-device:${input.deviceId}`
  if (sharedWithUserIds.length > 0) {
    await grantAgentRuntimeAccessToMembers({
      orgId: input.orgId,
      runtimeTargetId,
      agentId,
      memberUserIds: sharedWithUserIds,
      actorUserId: input.actorUserId,
    })
  }
  return {
    agent: { ...agent, ...(botComputer ? { botComputer } : {}) },
    deviceId: input.deviceId,
    runtimeTargetId,
    enqueuedJobIds: sync.enqueuedJobIds,
  }
}

export function memberOrgRole(value: unknown): OrgRole {
  return value === 'owner' || value === 'admin' || value === 'viewer' ? value : 'member'
}
