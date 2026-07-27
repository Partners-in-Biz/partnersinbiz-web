/**
 * GET /api/v1/orgs/[orgId]/visible-agents
 *
 * Auth: admin or client (any org member)
 * Returns: enabled agents from agent_team, filtered to the caller's visible set,
 *          with apiKey stripped entirely.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { orgChatConfigDoc, resolveVisibleAgents } from '@/lib/conversations/conversations'
import { memberCanUseAgentOnRuntime } from '@/lib/orgMembers/access-policy'
import { AGENT_IDS, type AgentId } from '@/lib/agents/types'
import type { AgentTeamStoredDoc } from '@/lib/agents/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ orgId: string }> }

export const GET = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)

    // Determine caller role — ai acts as admin
    const callerRole: 'admin' | 'client' =
      user.role === 'admin' || user.role === 'ai' ? 'admin' : 'client'

    // Read org chat config (may be null — defaults applied in resolveVisibleAgents)
    const configDoc = await orgChatConfigDoc(scope.orgId).get()
    const config = configDoc.exists
      ? (configDoc.data() as { visibleAgents?: { admin?: AgentId[]; client?: AgentId[] } })
      : null

    const allowedAgentIds = new Set<AgentId>(resolveVisibleAgents(config, callerRole))
    const runtimeTargetId = req.nextUrl.searchParams.get('runtimeTarget')?.trim()
    // A Team-admin may delegate selected profiles on a selected computer to a
    // member. This supplements—not replaces—the ordinary role visibility list.
    if (user.role !== 'admin' && runtimeTargetId) {
      for (const agentId of AGENT_IDS) {
        if (memberCanUseAgentOnRuntime(user.memberAccessPolicy, runtimeTargetId, agentId)) {
          allowedAgentIds.add(agentId)
        }
      }
    }

    // Read enabled agents from agent_team
    const snap = await adminDb.collection('agent_team').get()

    const result = snap.docs
      .map((d) => {
        const stored = d.data() as AgentTeamStoredDoc
        // agentId is stored in the doc itself; the doc ID is the same value
        return stored
      })
      .filter((agent) => agent.enabled && allowedAgentIds.has(agent.agentId))
      .map((agent) => {
        // Strip apiKey entirely — never expose, even masked
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { apiKey: _apiKey, ...safe } = agent
        return safe
      })

    return apiSuccess(result)
  },
)
