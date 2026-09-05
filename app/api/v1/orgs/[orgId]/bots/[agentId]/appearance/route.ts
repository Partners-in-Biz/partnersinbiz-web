/**
 * GET   /api/v1/orgs/[orgId]/bots/[agentId]/appearance — Bot mode look + mailbox for one bot
 * PATCH /api/v1/orgs/[orgId]/bots/[agentId]/appearance — pick a built-in animated style or clear the upload
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { loadBotAppearance, saveBotAppearance } from '@/lib/agents/bot-appearance'
import { resolveBotProfileAccess } from '@/lib/agents/bot-profile-access'
import { isBotAvatarStyle } from '@/lib/messages/bot-profile'

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
    const appearance = await loadBotAppearance(scope.orgId, agentId)
    return apiSuccess({
      agentId,
      avatarUrl: appearance?.avatarUrl ?? null,
      avatarStyle: appearance?.avatarStyle ?? 'blob',
      mailbox: access.agent.mailbox ?? null,
      canEditLook: access.canEditLook,
      canProvisionMailbox: access.canProvisionMailbox,
    })
  },
)

export const PATCH = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam, agentId } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const body = await req.json().catch(() => null) as { avatarStyle?: unknown; avatarUrl?: unknown } | null
    if (!body) return apiError('Invalid JSON body', 400)
    if (!isBotAvatarStyle(body.avatarStyle)) return apiError('avatarStyle must be blob, geometric, or image', 400)

    const access = await resolveBotProfileAccess({ user, orgId: scope.orgId, botId: agentId })
    if (!access.ok) return apiError(access.error, access.status)
    if (!access.canEditLook) return apiError('You cannot change this Bot\'s look', 403)

    const current = await loadBotAppearance(scope.orgId, agentId)
    let avatarUrl: string | null = current?.avatarUrl ?? null
    if (body.avatarUrl === null) avatarUrl = null
    if (body.avatarStyle === 'image' && !avatarUrl) {
      return apiError('Upload an image before choosing the image style', 400)
    }

    const saved = await saveBotAppearance({
      orgId: scope.orgId,
      agentId,
      actorUserId: user.uid,
      avatarUrl,
      avatarStyle: body.avatarStyle,
    })
    return apiSuccess({ agentId, ...saved })
  },
)
