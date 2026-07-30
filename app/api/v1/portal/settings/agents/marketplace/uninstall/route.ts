/**
 * POST /api/v1/portal/settings/agents/marketplace/uninstall
 *
 * Remove a marketplace agent from a computer (uninstall job). Does not delete
 * the agent_team registry row so it can be re-pulled later.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import { canConfigureMarketplaceAgent } from '@/lib/agents/marketplace'
import {
  listDeviceDesiredAgents,
  setDeviceDesiredAgents,
} from '@/lib/linked-computers/agent-host-service'
import type { AgentTeamStoredDoc } from '@/lib/agents/types'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import type { OrgRole } from '@/lib/organizations/types'
import { linkedDeviceOwnerType } from '@/lib/linked-computers/policy'

export const dynamic = 'force-dynamic'

export const POST = withPortalAuthAndRole(
  'viewer',
  async (req: NextRequest, uid: string, orgId: string, role: OrgRole) => {
    let body: Record<string, unknown>
    try {
      body = await req.json() as Record<string, unknown>
    } catch {
      return apiError('Invalid JSON body', 400)
    }

    const agentId = String(body.agentId ?? '').trim()
    const deviceId = String(body.deviceId ?? '').trim()
    if (!agentId) return apiError('Agent ID is required', 400)
    if (!deviceId) return apiError('Computer is required', 400)

    const agentDoc = await adminDb.collection('agent_team').doc(agentId).get()
    const agent = agentDoc.data() as AgentTeamStoredDoc | undefined
    if (!agentDoc.exists || !agent || agent.scopeOrgId !== orgId) {
      return apiError('Agent not found', 404)
    }
    if (agent.agentKind !== 'marketplace' && !agent.marketplaceTemplateId) {
      return apiError('Only marketplace agents can be uninstalled through this path', 400)
    }
    if (!canConfigureMarketplaceAgent({ agent, actorUserId: uid, orgId, role })) {
      return apiError('You cannot uninstall this marketplace agent', 403)
    }

    const deviceDoc = await adminDb.collection('linked_devices').doc(deviceId).get()
    if (!deviceDoc.exists) return apiError('Computer not found', 404)
    const device = { deviceId, ...deviceDoc.data() } as LinkedDevice
    const ownerType = linkedDeviceOwnerType(device)
    if (ownerType === 'user' && device.ownerUserId !== uid) {
      return apiError('You can only uninstall from computers you own', 403)
    }
    if (ownerType === 'organization') {
      if (device.ownerOrgId !== orgId) return apiError('Computer belongs to another organisation', 403)
      if (role !== 'owner' && role !== 'admin') {
        return apiError('Only organisation owners and admins can uninstall from the org VPS', 403)
      }
    }

    try {
      const inventory = await listDeviceDesiredAgents(deviceId)
      const remaining = inventory.desiredAgents
        .filter((row) => row.agentId !== agentId)
        .map((row) => ({ agentId: row.agentId, keepInSync: row.keepInSync }))

      const sync = await setDeviceDesiredAgents({
        deviceId,
        actorUserId: uid,
        orgId,
        desired: remaining,
      })

      return NextResponse.json({
        data: {
          agentId,
          deviceId,
          enqueuedJobIds: sync.enqueuedJobIds,
          status: 'uninstalling',
          message: 'Marketplace agent will be removed from this computer. The library entry remains so you can pull it again later.',
        },
      })
    } catch (error) {
      return apiErrorFromException(error)
    }
  },
)
