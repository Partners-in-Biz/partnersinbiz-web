/**
 * PATCH /api/v1/portal/settings/agents/marketplace/skills
 *
 * Update the public-skill selection on a marketplace agent instance and
 * re-sync the pack to devices that host it.
 *
 * GET is served via the main agents list (`data.skills`); this route is write-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import {
  canConfigureMarketplaceAgent,
  listMarketplaceSkills,
  sanitizeMarketplaceSkills,
} from '@/lib/agents/marketplace'
import { setMarketplaceAgentSkills } from '@/lib/agents/team'
import {
  enqueueLinkedAgentProfileSync,
  listDeviceDesiredAgents,
  setDeviceDesiredAgents,
} from '@/lib/linked-computers/agent-host-service'
import type { AgentTeamStoredDoc } from '@/lib/agents/types'
import type { OrgRole } from '@/lib/organizations/types'
import { linkedAgentProfileRevision } from '@/lib/agents/org-agent-policy'

export const dynamic = 'force-dynamic'

export const GET = withPortalAuthAndRole(
  'viewer',
  async () => {
    return NextResponse.json({
      data: {
        skills: listMarketplaceSkills(),
        tier: 'public',
      },
    })
  },
)

export const PATCH = withPortalAuthAndRole(
  'viewer',
  async (req: NextRequest, uid: string, orgId: string, role: OrgRole) => {
    let body: Record<string, unknown>
    try {
      body = await req.json() as Record<string, unknown>
    } catch {
      return apiError('Invalid JSON body', 400)
    }

    const agentId = String(body.agentId ?? '').trim()
    if (!agentId) return apiError('Agent ID is required', 400)

    const agentDoc = await adminDb.collection('agent_team').doc(agentId).get()
    const agent = agentDoc.data() as AgentTeamStoredDoc | undefined
    if (!agentDoc.exists || !agent || agent.scopeOrgId !== orgId) {
      return apiError('Agent not found', 404)
    }
    if (!canConfigureMarketplaceAgent({ agent, actorUserId: uid, orgId, role })) {
      return apiError('You cannot configure skills for this marketplace agent', 403)
    }

    const skills = sanitizeMarketplaceSkills(body.skills)
    if (skills.length === 0) {
      return apiError('Select at least one public marketplace skill', 400)
    }

    try {
      const updated = await setMarketplaceAgentSkills(agentId, skills)

      // Force re-install/sync on home device + any device currently desiring this agent.
      const enqueuedJobIds: string[] = []
      const deviceIds = new Set<string>()
      if (updated.homeDeviceId) deviceIds.add(updated.homeDeviceId)

      // Best-effort: re-assert desired keep-in-sync on the home device so pack version updates.
      if (updated.homeDeviceId) {
        try {
          const inventory = await listDeviceDesiredAgents(updated.homeDeviceId)
          const desired = inventory.desiredAgents.map((row) => ({
            agentId: row.agentId,
            keepInSync: row.agentId === agentId ? true : row.keepInSync,
          }))
          if (!desired.some((row) => row.agentId === agentId)) {
            desired.push({ agentId, keepInSync: true })
          }
          const sync = await setDeviceDesiredAgents({
            deviceId: updated.homeDeviceId,
            actorUserId: uid,
            orgId,
            desired,
          })
          enqueuedJobIds.push(...sync.enqueuedJobIds)
        } catch {
          // fall through to profile sync
        }
      }

      const profileJobs = await enqueueLinkedAgentProfileSync({
        agentId: agentId as import('@/lib/agents/types').AgentId,
        actorUserId: uid,
        orgId,
        profileRevision: linkedAgentProfileRevision({
          name: updated.name,
          role: updated.role,
          persona: updated.persona,
          defaultModel: `${updated.defaultModel || 'auto'}:${skills.join(',')}`,
        }),
      })
      enqueuedJobIds.push(...profileJobs)

      return NextResponse.json({
        data: {
          agent: updated,
          skills: updated.marketplaceSkills ?? skills,
          enqueuedJobIds,
          message: 'Public skills updated. Pack re-sync queued on linked computers.',
        },
      })
    } catch (error) {
      return apiErrorFromException(error)
    }
  },
)
