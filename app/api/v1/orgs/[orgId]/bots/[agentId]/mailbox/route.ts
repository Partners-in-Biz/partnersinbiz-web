/**
 * GET  /api/v1/orgs/[orgId]/bots/[agentId]/mailbox — the Bot's own email address (if provisioned)
 * POST /api/v1/orgs/[orgId]/bots/[agentId]/mailbox — provision an inbox through the Hermes Mail Agent
 *
 * No address is ever invented here: the Hermes runtime must return one, otherwise
 * the response carries the [NEED] note and nothing is stored.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { provisionBotMailbox } from '@/lib/agents/bot-mailbox'
import { resolveBotProfileAccess } from '@/lib/agents/bot-profile-access'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ orgId: string; agentId: string }> }

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam, agentId } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const access = await resolveBotProfileAccess({ user, orgId: scope.orgId, botId: agentId })
    if (!access.ok) return apiError(access.error, access.status)
    return apiSuccess({
      agentId,
      mailbox: access.agent.mailbox ?? null,
      canProvisionMailbox: access.canProvisionMailbox,
    })
  },
)

export const POST = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam, agentId } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const access = await resolveBotProfileAccess({ user, orgId: scope.orgId, botId: agentId })
    if (!access.ok) return apiError(access.error, access.status)
    if (!access.canProvisionMailbox) return apiError('Only a Bot manager can provision its mailbox', 403)

    const existing = access.agent.mailbox
    if (existing && existing.status === 'active' && existing.address) {
      return apiSuccess({ agentId, mailbox: existing, canProvisionMailbox: true })
    }

    const result = await provisionBotMailbox({
      agentId: access.agent.agentId,
      displayName: access.agent.name || access.agent.agentId,
    })
    if (!result.ok) return apiError(result.error, result.status)
    return apiSuccess({ agentId, mailbox: result.mailbox, canProvisionMailbox: true }, 201)
  },
)
