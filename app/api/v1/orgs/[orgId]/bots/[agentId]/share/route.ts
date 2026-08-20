/**
 * POST /api/v1/orgs/[orgId]/bots/[agentId]/share
 * Create a shareable GrokBot link from a custom linked Bot the caller can manage.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { canManageLinkedAgent } from '@/lib/agents/org-agent-policy'
import type { AgentTeamStoredDoc } from '@/lib/agents/types'
import { canShareAgentAsGrokBot, parseBotShareVisibility } from '@/lib/messages/bot-shares'
import { createBotShare } from '@/lib/messages/bot-share-store'
import { memberOrgRole } from '@/lib/messages/provision-custom-bot'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ orgId: string; agentId: string }> }

export const POST = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam, agentId } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const trimmedAgentId = agentId.trim()
    if (!trimmedAgentId) return apiError('Bot id is required', 400)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const visibility = parseBotShareVisibility(body.visibility)
    const allowClone = body.allowClone !== false

    const membership = await adminDb.collection('orgMembers').doc(`${scope.orgId}_${user.uid}`).get()
    const role = user.role === 'admin' ? 'owner' : memberOrgRole(membership.data()?.role)

    const agentDoc = await adminDb.collection('agent_team').doc(trimmedAgentId).get()
    const agent = agentDoc.data() as AgentTeamStoredDoc | undefined
    if (!agentDoc.exists || !agent || agent.scopeOrgId !== scope.orgId) {
      return apiError('Bot not found', 404)
    }
    if (!canShareAgentAsGrokBot(agent)) {
      return apiError('Only custom Bots can be shared', 400)
    }
    if (!canManageLinkedAgent({ agent, actorUserId: user.uid, orgId: scope.orgId, role })) {
      return apiError('You cannot share this Bot', 403)
    }

    try {
      const share = await createBotShare({
        sourceOrgId: scope.orgId,
        sourceAgentId: trimmedAgentId,
        visibility,
        allowClone,
        createdByUserId: user.uid,
        agent,
      })
      return apiSuccess({
        shareId: share.shareId,
        visibility: share.visibility,
        allowClone: share.allowClone,
        name: share.snapshot.name,
      }, 201)
    } catch (error) {
      return apiErrorFromException(error)
    }
  },
)
