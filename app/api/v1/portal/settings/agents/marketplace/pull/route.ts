/**
 * POST /api/v1/portal/settings/agents/marketplace/pull
 *
 * Pull a marketplace template agent onto a computer the caller may use.
 * Creates a scoped marketplace instance (mp-*) if needed, then enqueues install
 * with the **public** skill pack only (never full PiB ops packs).
 */
import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import {
  getMarketplaceTemplate,
  isMarketplaceTemplateId,
  resolveMarketplacePullScope,
} from '@/lib/agents/marketplace'
import { ensureMarketplaceAgent } from '@/lib/agents/team'
import {
  listDeviceDesiredAgents,
  setDeviceDesiredAgents,
} from '@/lib/linked-computers/agent-host-service'
import { runtimeSupportsCustomAgentProfiles } from '@/lib/agents/org-agent-policy'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import type { OrgRole } from '@/lib/organizations/types'

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

    const templateId = String(body.templateId ?? '').trim()
    const deviceId = String(body.deviceId ?? '').trim()
    if (!isMarketplaceTemplateId(templateId)) {
      return apiError('Unknown marketplace template', 400)
    }
    if (!deviceId) return apiError('Choose a computer to pull this agent onto', 400)

    const template = getMarketplaceTemplate(templateId)
    if (!template) return apiError('Unknown marketplace template', 400)

    const deviceDoc = await adminDb.collection('linked_devices').doc(deviceId).get()
    if (!deviceDoc.exists) return apiError('Computer not found', 404)
    const device = { deviceId, ...deviceDoc.data() } as LinkedDevice
    if (device.status !== 'active') return apiError('An active computer is required', 409)
    if (!runtimeSupportsCustomAgentProfiles(device.runtimeVersion)) {
      return apiError('Update this linked computer runtime before pulling marketplace agents', 409)
    }

    let pullScope: ReturnType<typeof resolveMarketplacePullScope>
    try {
      pullScope = resolveMarketplacePullScope({
        device,
        actorUserId: uid,
        orgId,
        role,
      })
    } catch (error) {
      return apiError(error instanceof Error ? error.message : 'You cannot install agents on this computer', 403)
    }

    try {
      const { agent, created } = await ensureMarketplaceAgent({
        templateId,
        scope: pullScope.scope,
        scopeId: pullScope.scopeId,
        orgId,
        createdByUserId: uid,
        homeDeviceId: deviceId,
        accessScope: pullScope.accessScope,
        ownerUserId: pullScope.accessScope === 'personal' ? uid : undefined,
      })

      const inventory = await listDeviceDesiredAgents(deviceId)
      const desired = inventory.desiredAgents.map((row) => ({
        agentId: row.agentId,
        keepInSync: row.keepInSync,
      }))
      if (!desired.some((row) => row.agentId === agent.agentId)) {
        desired.push({ agentId: agent.agentId, keepInSync: true })
      } else {
        // Ensure keep-in-sync so public pack stays current.
        const index = desired.findIndex((row) => row.agentId === agent.agentId)
        if (index >= 0) desired[index] = { agentId: agent.agentId, keepInSync: true }
      }

      const sync = await setDeviceDesiredAgents({
        deviceId,
        actorUserId: uid,
        orgId,
        desired,
      })

      return NextResponse.json({
        data: {
          agent,
          templateId,
          deviceId,
          created,
          enqueuedJobIds: sync.enqueuedJobIds,
          status: 'installing',
          pack: 'public',
          message: created
            ? `${template.name} is installing on this computer with the public skill pack.`
            : `${template.name} is already in your library; re-syncing the public pack to this computer.`,
        },
      }, { status: created ? 201 : 200 })
    } catch (error) {
      return apiErrorFromException(error)
    }
  },
)
