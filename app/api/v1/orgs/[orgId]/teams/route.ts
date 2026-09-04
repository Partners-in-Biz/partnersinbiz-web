import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'
import { assertCanManageTeams } from '@/lib/org-teams/service'
import { createOrgTeam, listOrgTeams } from '@/lib/org-teams/store'
import { normalizeOrgTeamSlug } from '@/lib/org-teams/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orgId: string }> }

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { orgId } = await (ctx as Ctx).params
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!(await orgFeatureFlagEnabled(orgId, 'orgTeamsEnabled'))) return apiError('feature_disabled', 404)
  return apiSuccess({ teams: await listOrgTeams(orgId) })
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { orgId } = await (ctx as Ctx).params
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!(await orgFeatureFlagEnabled(orgId, 'orgTeamsEnabled'))) return apiError('feature_disabled', 404)
  await assertCanManageTeams(user, orgId)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return apiError('Malformed JSON body', 400)
  const slug = normalizeOrgTeamSlug(body.slug)
  const name = typeof body.name === 'string' ? body.name : ''
  const description = typeof body.description === 'string' ? body.description : undefined
  const memberUserIds = asStringArray(body.memberUserIds).slice(0, 500)
  const leadUserIds = asStringArray(body.leadUserIds).slice(0, 500)
  if (!slug || !name.trim()) return apiError('slug and name are required', 400)

  const team = await createOrgTeam({
    orgId,
    slug,
    name,
    description,
    actorUserId: user.uid,
    memberUserIds,
    leadUserIds,
  })
  return apiSuccess({ team }, 201)
})
