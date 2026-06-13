import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveStrictGeoOrg } from '@/lib/geo-seo/api'
import { publishGeoReport } from '@/lib/geo-seo/reports'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const org = resolveStrictGeoOrg(req, user, body as Record<string, unknown>)
  if (org.ok === false) return org.response

  const result = await publishGeoReport({
    reportId: id,
    orgId: org.orgId,
    approvalEvidenceId: typeof body.approvalEvidenceId === 'string' ? body.approvalEvidenceId : undefined,
    approvedBy: typeof body.approvedBy === 'string' ? body.approvedBy : undefined,
    user,
  })

  if (!result.ok) {
    return apiError(result.error, result.status, 'approvalRequired' in result ? { approvalRequired: result.approvalRequired } : undefined)
  }
  return apiSuccess(result.value)
})
