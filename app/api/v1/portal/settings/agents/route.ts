import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import { createLinkedAgent, updateLinkedAgent } from '@/lib/agents/team'
import type { AgentTeamStoredDoc } from '@/lib/agents/types'
import {
  canConfigureMarketplaceAgent,
  listMarketplaceSkills,
  listMarketplaceTemplates,
  marketplacePublicSkillsForAgent,
} from '@/lib/agents/marketplace'
import {
  assertCanCreateAgentOnDevice,
  buildScopedAgentId,
  canManageLinkedAgent,
  linkedAgentProfileRevision,
  ORG_AGENT_HANDLE_RE,
  parseLinkedAgentUpdateFields,
  runtimeSupportsCustomAgentProfiles,
} from '@/lib/agents/org-agent-policy'
import {
  enqueueLinkedAgentProfileSync,
  finalizeLinkedAgentProvisioning,
  listDeviceDesiredAgents,
  setDeviceDesiredAgents,
} from '@/lib/linked-computers/agent-host-service'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import type { OrgRole } from '@/lib/organizations/types'
import {
  grantAgentRuntimeAccessToMembers,
  parseSharedMemberUserIds,
  resolveCreatedAgentAccess,
} from '@/lib/orgMembers/agent-runtime-grants'

export const dynamic = 'force-dynamic'

function safeAgent(agent: AgentTeamStoredDoc) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { apiKey: _apiKey, ...safe } = agent
  return safe
}

export const GET = withPortalAuthAndRole(
  'viewer',
  async (_req: NextRequest, uid: string, orgId: string, role: OrgRole) => {
    try {
      const [agentSnap, personalDeviceSnap, orgDeviceSnap] = await Promise.all([
        adminDb.collection('agent_team').where('scopeOrgId', '==', orgId).get(),
        adminDb.collection('linked_devices').where('ownerUserId', '==', uid).get(),
        role === 'owner' || role === 'admin'
          ? adminDb.collection('linked_devices').where('ownerOrgId', '==', orgId).get()
          : Promise.resolve({ docs: [] }),
      ])
      const member = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
      const { normalizeMemberAccessPolicy } = await import('@/lib/orgMembers/access-policy')
      const policy = normalizeMemberAccessPolicy(member.data()?.accessPolicy)
      const grantedAgentIds = new Set(Object.values(policy.agentRuntimeAccess).flat())
      const canManageOrgAgents = role === 'owner' || role === 'admin'

      const agents = agentSnap.docs
        .map((doc) => safeAgent(doc.data() as AgentTeamStoredDoc))
        .filter((agent) => {
          const isMarketplace = agent.agentKind === 'marketplace' || Boolean(agent.marketplaceTemplateId)
          if (agent.accessScope === 'personal') {
            return agent.ownerUserId === uid || grantedAgentIds.has(agent.agentId)
          }
          // Org marketplace instances are visible to every member; other org agents stay admin-gated.
          if (isMarketplace) return true
          return canManageOrgAgents || agent.ownerUserId === uid || grantedAgentIds.has(agent.agentId)
        })
        .map((agent) => {
          const isMarketplace = agent.agentKind === 'marketplace' || Boolean(agent.marketplaceTemplateId)
          const canConfigure = isMarketplace
            ? canConfigureMarketplaceAgent({ agent, actorUserId: uid, orgId, role })
            : false
          const installedSkills = isMarketplace
            ? marketplacePublicSkillsForAgent(agent.agentId, agent.marketplaceSkills)
            : []
          return {
            ...agent,
            isMarketplace,
            canManage: canManageLinkedAgent({
              agent,
              actorUserId: uid,
              orgId,
              role,
            }),
            hasAccess: agent.ownerUserId === uid
              || (canManageOrgAgents && agent.accessScope !== 'personal')
              || (isMarketplace && agent.accessScope === 'organization')
              || grantedAgentIds.has(agent.agentId),
            canEdit: canManageLinkedAgent({
              agent,
              actorUserId: uid,
              orgId,
              role,
            }),
            canConfigureMarketplace: canConfigure,
            installedSkills,
          }
        })
      const devices = [...personalDeviceSnap.docs, ...orgDeviceSnap.docs]
        .filter((doc, index, all) => all.findIndex((candidate) => candidate.id === doc.id) === index)
        .map((doc) => {
          const device = doc.data() as LinkedDevice
          return {
            deviceId: doc.id,
            runtimeTargetId: device.runtimeTargetId || `linked-device:${doc.id}`,
            label: device.label,
            deviceKind: device.deviceKind === 'vps' ? 'vps' : 'computer',
            ownerType: device.ownerType === 'organization' ? 'organization' : 'user',
            status: device.status,
            runtimeVersion: device.runtimeVersion,
            supportsCustomAgents: runtimeSupportsCustomAgentProfiles(device.runtimeVersion),
          }
        })
        .filter((device) => device.status === 'active')

      const marketplace = listMarketplaceTemplates().map((template) => ({
        templateId: template.templateId,
        name: template.name,
        role: template.role,
        summary: template.summary,
        iconKey: template.iconKey,
        colorKey: template.colorKey,
        publicSkillCount: template.publicSkills.length,
        publicSkills: template.publicSkills,
        editable: false,
        pack: 'public' as const,
      }))

      return NextResponse.json({
        data: {
          agents,
          devices,
          canManageOrgAgents,
          marketplace,
          skills: listMarketplaceSkills(),
        },
      })
    } catch (error) {
      return apiErrorFromException(error)
    }
  },
)

export const POST = withPortalAuthAndRole(
  'viewer',
  async (req: NextRequest, uid: string, orgId: string, role: OrgRole) => {
    let body: Record<string, unknown>
    try {
      body = await req.json() as Record<string, unknown>
    } catch {
      return apiError('Invalid JSON body', 400)
    }

    const existingHandles = await adminDb.collection('agent_team').where('scopeOrgId', '==', orgId).get()
    const taken = existingHandles.docs.map((doc) => String((doc.data() as { agentHandle?: string }).agentHandle || ''))
    const { allocateBotHandle } = await import('@/lib/messages/bot-shares')
    const agentHandle = allocateBotHandle(body.agentId ?? body.agentHandle ?? body.handle, taken, String(body.name ?? ''))
      ?? String(body.agentId ?? '').trim().toLowerCase()
    const agentId = ORG_AGENT_HANDLE_RE.test(agentHandle)
      ? buildScopedAgentId(orgId, agentHandle)
      : ''
    const deviceId = String(body.deviceId ?? '').trim()
    const name = String(body.name ?? '').trim()
    const agentRole = String(body.role ?? 'Specialist').trim()
    const persona = String(body.persona ?? '').trim()
    const defaultModel = String(body.defaultModel ?? 'auto').trim() || 'auto'
    const iconKey = String(body.iconKey ?? 'smart_toy').trim() || 'smart_toy'
    const colorKey = String(body.colorKey ?? 'sky').trim() || 'sky'
    if (!agentId) return apiError('Agent ID must contain 2–20 lowercase letters, numbers, dots, dashes, or underscores', 400)
    if (!deviceId) return apiError('Choose a computer for this agent', 400)
    if (!name || !agentRole || !persona) return apiError('Name, role, and purpose are required', 400)
    if (name.length > 100) return apiError('Name must be 100 characters or fewer', 400)
    if (agentRole.length > 120) return apiError('Role must be 120 characters or fewer', 400)
    if (persona.length > 20_000) return apiError('Purpose and behaviour must be 20,000 characters or fewer', 400)
    if (defaultModel.length > 200) return apiError('Default model must be 200 characters or fewer', 400)
    if (!/^[a-z0-9_]{1,48}$/.test(iconKey)) return apiError('Invalid agent icon', 400)
    if (!['sky', 'violet', 'amber', 'emerald', 'rose', 'cyan', 'indigo', 'orange', 'teal', 'slate'].includes(colorKey)) {
      return apiError('Invalid agent colour', 400)
    }

    const deviceRef = adminDb.collection('linked_devices').doc(deviceId)
    const deviceDoc = await deviceRef.get()
    if (!deviceDoc.exists) return apiError('Computer not found', 404)
    const device = { deviceId, ...deviceDoc.data() } as LinkedDevice
    if (!runtimeSupportsCustomAgentProfiles(device.runtimeVersion)) {
      return apiError('Update this linked computer runtime before creating agents', 409)
    }
    let deviceAccessScope: 'personal' | 'organization'
    try {
      deviceAccessScope = assertCanCreateAgentOnDevice({ device, actorUserId: uid, orgId, role })
    } catch (error) {
      return apiError(error instanceof Error ? error.message : 'You cannot create an agent on this computer', 403)
    }
    const createdAccess = resolveCreatedAgentAccess({
      deviceAccessScope,
      requested: body.accessMode === 'organization' || body.accessMode === 'people' || body.accessMode === 'personal'
        ? body.accessMode
        : undefined,
    })
    const accessScope = createdAccess.accessScope
    const sharedWithUserIds = createdAccess.grantMembers
      ? parseSharedMemberUserIds(body.sharedWithUserIds)
      : []

    try {
      const agent = await createLinkedAgent({
        agentId,
        name,
        role: agentRole,
        persona,
        defaultModel,
        iconKey,
        colorKey,
        scopeOrgId: orgId,
        agentHandle,
        ownerUserId: accessScope === 'personal' ? uid : undefined,
        createdByUserId: uid,
        homeDeviceId: deviceId,
        accessScope,
      })

      try {
        const inventory = await listDeviceDesiredAgents(deviceId)
        const desired = inventory.desiredAgents.map((row) => ({
          agentId: row.agentId,
          keepInSync: row.keepInSync,
        }))
        if (!desired.some((row) => row.agentId === agentId)) {
          desired.push({ agentId, keepInSync: true })
        }
        const sync = await setDeviceDesiredAgents({
          deviceId,
          actorUserId: uid,
          orgId,
          desired,
        })
        const runtimeTargetId = device.runtimeTargetId || `linked-device:${deviceId}`
        if (sharedWithUserIds.length > 0) {
          await grantAgentRuntimeAccessToMembers({
            orgId,
            runtimeTargetId,
            agentId,
            memberUserIds: sharedWithUserIds,
            actorUserId: uid,
          })
        }
        return NextResponse.json({
          data: {
            agent,
            deviceId,
            runtimeTargetId,
            enqueuedJobIds: sync.enqueuedJobIds,
            status: 'installing',
          },
        }, { status: 201 })
      } catch (error) {
        // Keep the registry row as the durable provisioning saga anchor. A
        // device update or queue write may already have succeeded, so deleting
        // only this row would orphan a signed install job with no tenant owner.
        const createdRef = adminDb.collection('agent_team').doc(agentId)
        const createdDoc = await createdRef.get().catch(() => null)
        const createdRow = createdDoc?.data()
        if (createdDoc?.exists
          && createdRow?.scopeOrgId === orgId
          && createdRow?.createdByUserId === uid
          && createdRow?.homeDeviceId === deviceId) {
          await createdRef.update({
            provisioningStatus: 'failed',
            provisioningError: error instanceof Error ? error.message.slice(0, 500) : 'Agent installation could not be queued',
            updatedAt: new Date(),
          }).catch(() => undefined)
        }
        throw error
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create agent'
      if (/already exists|already_exists|6 ALREADY_EXISTS/i.test(message)) {
        return apiError('An agent with that ID already exists in this organisation', 409)
      }
      return apiErrorFromException(error)
    }
  },
)

export const PATCH = withPortalAuthAndRole(
  'viewer',
  async (req: NextRequest, uid: string, orgId: string, role: OrgRole) => {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const agentId = typeof body?.agentId === 'string' ? body.agentId.trim() : ''
    if (!agentId) return apiError('Agent ID is required', 400)

    const agentRef = adminDb.collection('agent_team').doc(agentId)
    const agentDoc = await agentRef.get()
    const agent = agentDoc.data() as AgentTeamStoredDoc | undefined
    if (!agentDoc.exists || !agent || agent.scopeOrgId !== orgId || agent.provisioningMode !== 'linked_device') {
      return apiError('Agent not found', 404)
    }
    if (!canManageLinkedAgent({ agent, actorUserId: uid, orgId, role })) {
      return apiError('You cannot manage this agent', 403)
    }

    const updateKeys = ['name', 'role', 'persona', 'defaultModel', 'iconKey', 'colorKey'] as const
    const isFieldUpdate = updateKeys.some((key) => body && Object.prototype.hasOwnProperty.call(body, key))
    const action = typeof body?.action === 'string' ? body.action.trim().toLowerCase() : ''

    // --- Field update (owner / org admin) ---
    if (isFieldUpdate || action === 'update') {
      const parsed = parseLinkedAgentUpdateFields(body ?? {}, {
        name: agent.name,
        role: agent.role,
        persona: agent.persona,
        defaultModel: agent.defaultModel || 'auto',
        iconKey: agent.iconKey || 'smart_toy',
        colorKey: agent.colorKey || 'sky',
      })
      if (!parsed.ok) return apiError(parsed.error, 400)

      try {
        const updated = parsed.changed
          ? await updateLinkedAgent(agentId, parsed.fields)
          : {
              ...agent,
              apiKey: '●●●●●●',
            }

        let enqueuedJobIds: string[] = []
        if (parsed.changed) {
          enqueuedJobIds = await enqueueLinkedAgentProfileSync({
            agentId: agentId as import('@/lib/agents/types').AgentId,
            actorUserId: uid,
            orgId,
            profileRevision: linkedAgentProfileRevision(parsed.fields),
          })
        }

        return NextResponse.json({
          data: {
            agent: updated,
            enqueuedJobIds,
            status: enqueuedJobIds.length > 0 ? 'syncing' : 'ready',
            message: enqueuedJobIds.length > 0
              ? 'Agent saved. Profile sync queued on linked computers.'
              : 'Agent saved. No profile changes to sync.',
          },
        })
      } catch (error) {
        return apiErrorFromException(error)
      }
    }

    // --- Retry failed install (existing behaviour) ---
    if (!agent.homeDeviceId) return apiError('Agent has no home computer', 409)

    const deviceDoc = await adminDb.collection('linked_devices').doc(agent.homeDeviceId).get()
    if (!deviceDoc.exists) return apiError('Computer not found', 404)
    const device = { deviceId: agent.homeDeviceId, ...deviceDoc.data() } as LinkedDevice
    try {
      if (!runtimeSupportsCustomAgentProfiles(device.runtimeVersion)) {
        return apiError('Update this linked computer runtime before retrying the agent', 409)
      }
      assertCanCreateAgentOnDevice({ device, actorUserId: uid, orgId, role })
      await agentRef.update({
        provisioningStatus: 'installing',
        provisioningError: null,
        updatedAt: new Date(),
      })
      const inventory = await listDeviceDesiredAgents(agent.homeDeviceId)
      if (inventory.availableAgentIds.includes(agentId)) {
        const result = await finalizeLinkedAgentProvisioning({
          agent,
          deviceId: agent.homeDeviceId,
        })
        return NextResponse.json({
          data: {
            agentId,
            deviceId: agent.homeDeviceId,
            enqueuedJobIds: [],
            status: result.ready ? 'ready' : 'failed',
            error: result.error,
          },
        }, { status: result.ready ? 200 : 409 })
      }
      const desired = inventory.desiredAgents.map((row) => ({
        agentId: row.agentId,
        keepInSync: row.keepInSync,
      }))
      if (!desired.some((row) => row.agentId === agentId)) {
        desired.push({ agentId, keepInSync: true })
      }
      const sync = await setDeviceDesiredAgents({
        deviceId: agent.homeDeviceId,
        actorUserId: uid,
        orgId,
        desired,
      })
      return NextResponse.json({
        data: {
          agentId,
          deviceId: agent.homeDeviceId,
          enqueuedJobIds: sync.enqueuedJobIds,
          status: 'installing',
        },
      })
    } catch (error) {
      await agentRef.update({
        provisioningStatus: 'failed',
        provisioningError: error instanceof Error ? error.message.slice(0, 500) : 'Agent installation could not be queued',
        updatedAt: new Date(),
      }).catch(() => undefined)
      return apiErrorFromException(error)
    }
  },
)
