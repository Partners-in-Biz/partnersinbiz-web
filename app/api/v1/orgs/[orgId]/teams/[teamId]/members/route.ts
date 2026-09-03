import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'
import { assertCanEditTeamMembers } from '@/lib/org-teams/service'
import { getOrgTeam, setOrgTeamMembers } from '@/lib/org-teams/store'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orgId: string; teamId: string }> }

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').slice(0, 500)
}

export const PUT = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { orgId, teamId } = await (ctx as Ctx).params
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!(await orgFeatureFlagEnabled(orgId, 'orgTeamsEnabled'))) return apiError('feature_disabled', 404)

  const existing = await getOrgTeam(orgId, teamId)
  if (!existing) return apiError('Team not found', 404)
  await assertCanEditTeamMembers(user, existing)

  const body = await req.json().catch(() => null) as { memberUserIds?: unknown; leadUserIds?: unknown } | null
  if (!body || typeof body !== 'object') return apiError('Malformed JSON body', 400)

  const team = await setOrgTeamMembers({
    orgId,
    teamId,
    actorUserId: user.uid,
    memberUserIds: asStringArray(body.memberUserIds),
    leadUserIds: asStringArray(body.leadUserIds),
  })
  return apiSuccess({ team })
})
