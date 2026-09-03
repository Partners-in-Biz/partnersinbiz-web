import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'
import { archiveOrgTeamWithCascade, assertCanManageTeams } from '@/lib/org-teams/service'
import { getOrgTeam, updateOrgTeam } from '@/lib/org-teams/store'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orgId: string; teamId: string }> }

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { orgId, teamId } = await (ctx as Ctx).params
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!(await orgFeatureFlagEnabled(orgId, 'orgTeamsEnabled'))) return apiError('feature_disabled', 404)
  await assertCanManageTeams(user, orgId)

  const existing = await getOrgTeam(orgId, teamId)
  if (!existing) return apiError('Team not found', 404)

  const body = await req.json().catch(() => null) as { name?: unknown; description?: unknown } | null
  if (!body || typeof body !== 'object') return apiError('Malformed JSON body', 400)
  const team = await updateOrgTeam({
    orgId,
    teamId,
    actorUserId: user.uid,
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
  })
  return apiSuccess({ team })
})

export const DELETE = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { orgId, teamId } = await (ctx as Ctx).params
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!(await orgFeatureFlagEnabled(orgId, 'orgTeamsEnabled'))) return apiError('feature_disabled', 404)
  await assertCanManageTeams(user, orgId)

  const existing = await getOrgTeam(orgId, teamId)
  if (!existing) return apiError('Team not found', 404)

  const result = await archiveOrgTeamWithCascade({ orgId, teamId, actor: user })
  return apiSuccess(result)
})
