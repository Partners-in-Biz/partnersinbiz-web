/**
 * GET  /api/v1/orgs/[orgId]/bots — devices + custom GrokBots for Bot mode
 * POST /api/v1/orgs/[orgId]/bots — create a shareable custom Bot on a linked computer / VPS
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { canManageLinkedAgent, runtimeSupportsCustomAgentProfiles } from '@/lib/agents/org-agent-policy'
import type { AgentTeamStoredDoc } from '@/lib/agents/types'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import { allocateBotHandle, canShareAgentAsGrokBot, sanitizeBotHandle } from '@/lib/messages/bot-shares'
import { listAgentPresenceForOrg } from '@/lib/messages/agent-presence'
import { memberOrgRole, provisionCustomBotOnDevice } from '@/lib/messages/provision-custom-bot'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ orgId: string }> }

function safeAgent(agent: AgentTeamStoredDoc) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { apiKey: _apiKey, ...safe } = agent
  return safe
}

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)

    const membership = await adminDb.collection('orgMembers').doc(`${scope.orgId}_${user.uid}`).get()
    const role = memberOrgRole(membership.data()?.role)
    const canManageOrgAgents = user.role === 'admin' || role === 'owner' || role === 'admin'

    const [agentSnap, personalDeviceSnap, orgDeviceSnap, presenceRows] = await Promise.all([
      adminDb.collection('agent_team').where('scopeOrgId', '==', scope.orgId).get(),
      adminDb.collection('linked_devices').where('ownerUserId', '==', user.uid).get(),
      canManageOrgAgents
        ? adminDb.collection('linked_devices').where('ownerOrgId', '==', scope.orgId).get()
        : Promise.resolve({ docs: [] as Array<{ id: string; data: () => unknown }> }),
      listAgentPresenceForOrg(scope.orgId),
    ])

    const agents = agentSnap.docs
      .map((doc) => safeAgent(doc.data() as AgentTeamStoredDoc))
      .filter((agent) => canShareAgentAsGrokBot(agent))
      .filter((agent) => {
        if (agent.accessScope === 'personal') return agent.ownerUserId === user.uid
        return canManageOrgAgents || agent.ownerUserId === user.uid
      })
      .map((agent) => ({
        ...agent,
        canShare: canManageLinkedAgent({ agent, actorUserId: user.uid, orgId: scope.orgId, role }),
      }))

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

    return apiSuccess({
      agents,
      devices,
      canCreate: devices.some((device) => device.supportsCustomAgents),
      presence: presenceRows.map((row) => ({
        agentId: row.agentId,
        state: row.state,
        ...(row.currentStep ? { currentStep: row.currentStep } : {}),
        ...(row.conversationId ? { conversationId: row.conversationId } : {}),
      })),
    })
  },
)

export const POST = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return apiError('Invalid JSON body', 400)

    const membership = await adminDb.collection('orgMembers').doc(`${scope.orgId}_${user.uid}`).get()
    const role = user.role === 'admin' ? 'owner' : memberOrgRole(membership.data()?.role)

    const name = String(body.name ?? '').trim()
    const roleTitle = String(body.role ?? 'Specialist').trim()
    const persona = String(body.persona ?? '').trim()
    const deviceId = String(body.deviceId ?? '').trim()
    const existingHandles = await adminDb.collection('agent_team').where('scopeOrgId', '==', scope.orgId).get()
    const taken = existingHandles.docs.map((doc) => String((doc.data() as { agentHandle?: string }).agentHandle || ''))
    const handle = allocateBotHandle(body.agentHandle ?? body.handle, taken, name)
    if (!handle || !sanitizeBotHandle(handle)) {
      return apiError('Bot ID must contain 2–20 lowercase letters, numbers, dots, dashes, or underscores', 400)
    }
    if (!deviceId) return apiError('Choose a computer for this Bot', 400)
    if (!name || !roleTitle || !persona) return apiError('Name, role, and purpose are required', 400)
    if (name.length > 100) return apiError('Name must be 100 characters or fewer', 400)
    if (roleTitle.length > 120) return apiError('Role must be 120 characters or fewer', 400)
    if (persona.length > 20_000) return apiError('Purpose and behaviour must be 20,000 characters or fewer', 400)

    try {
      const created = await provisionCustomBotOnDevice({
        orgId: scope.orgId,
        actorUserId: user.uid,
        role,
        handle,
        name,
        roleTitle,
        persona,
        defaultModel: String(body.defaultModel ?? 'auto').trim() || 'auto',
        iconKey: String(body.iconKey ?? 'smart_toy').trim() || 'smart_toy',
        colorKey: String(body.colorKey ?? 'sky').trim() || 'sky',
        deviceId,
        accessMode: body.accessMode === 'organization' || body.accessMode === 'people' || body.accessMode === 'personal'
          ? body.accessMode
          : undefined,
        sharedWithUserIds: body.sharedWithUserIds,
      })
      const { apiKey: _apiKey, ...safeAgent } = created.agent
      return apiSuccess({
        agent: safeAgent,
        deviceId: created.deviceId,
        runtimeTargetId: created.runtimeTargetId,
        enqueuedJobIds: created.enqueuedJobIds,
        status: 'installing',
      }, 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create Bot'
      const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : undefined
      if (status && status >= 400 && status < 600) return apiError(message, status)
      if (/already exists|already_exists|6 ALREADY_EXISTS/i.test(message)) {
        return apiError('A Bot with that ID already exists in this organisation', 409)
      }
      if (/cannot create|only organisation|computers they own|belongs to another/i.test(message)) {
        return apiError(message, 403)
      }
      return apiErrorFromException(error)
    }
  },
)
