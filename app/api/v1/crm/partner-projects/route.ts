import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { cleanString } from '@/lib/partner-links/identity'
import {
  grantPartnerProjectAccess,
  listPartnerProjects,
  revokePartnerProjectAccess,
} from '@/lib/partner-links/collaboration'

export const dynamic = 'force-dynamic'

/**
 * GET    projects shared out + shared with me
 * POST   { relationshipId, projectId, role?, includePartnerOrganization?, granteeUserIds?, granteeTeamIds? }
 * DELETE ?projectId=…&partnerOrgId=…           revoke it
 */
function cleanStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
}

export const GET = withCrmAuth('viewer', async (_req, ctx: CrmAuthContext) => {
  try {
    return apiSuccess(await listPartnerProjects(ctx.orgId))
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withCrmAuth('member', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const relationshipId = cleanString(body.relationshipId)
    const projectId = cleanString(body.projectId)
    if (!relationshipId) return apiError('relationshipId is required', 400)
    if (!projectId) return apiError('projectId is required', 400)
    if (body.granteeUserIds !== undefined && !Array.isArray(body.granteeUserIds)) return apiError('granteeUserIds must be an array', 400)
    if (body.granteeTeamIds !== undefined && !Array.isArray(body.granteeTeamIds)) return apiError('granteeTeamIds must be an array', 400)
    if (body.includePartnerOrganization !== undefined && typeof body.includePartnerOrganization !== 'boolean') {
      return apiError('includePartnerOrganization must be a boolean', 400)
    }

    const access = await grantPartnerProjectAccess({
      ownerOrgId: ctx.orgId,
      relationshipId,
      projectId,
      role: cleanString(body.role) || undefined,
      grantee: {
        includePartnerOrganization: body.includePartnerOrganization !== false,
        userIds: cleanStringArray(body.granteeUserIds),
        teamIds: cleanStringArray(body.granteeTeamIds),
      },
      actor: ctx.actor,
    })
    return apiSuccess({ access }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withCrmAuth('member', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const projectId = cleanString(req.nextUrl.searchParams.get('projectId'))
    const partnerOrgId = cleanString(req.nextUrl.searchParams.get('partnerOrgId'))
    if (!projectId || !partnerOrgId) return apiError('projectId and partnerOrgId are required', 400)

    await revokePartnerProjectAccess({
      ownerOrgId: ctx.orgId,
      projectId,
      partnerOrgId,
      actor: ctx.actor,
    })
    return apiSuccess({ projectId, partnerOrgId, revoked: true })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
