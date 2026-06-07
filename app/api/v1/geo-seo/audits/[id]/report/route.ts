import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { createGeoAuditReportDraft } from '@/lib/geo-seo/reports'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const requestedOrgId = typeof body.orgId === 'string'
    ? body.orgId
    : req.headers.get('X-Org-Id')
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const result = await createGeoAuditReportDraft({
    auditId: id,
    orgId: scope.orgId,
    sourceDocumentId: typeof body.sourceDocumentId === 'string' ? body.sourceDocumentId : undefined,
    sourceSpecVersion: typeof body.sourceSpecVersion === 'string' ? body.sourceSpecVersion : undefined,
    sourceDocumentSectionId: typeof body.sourceDocumentSectionId === 'string' ? body.sourceDocumentSectionId : undefined,
    approvalGateTaskId: typeof body.approvalGateTaskId === 'string' ? body.approvalGateTaskId : undefined,
    reportType: body.reportType,
    title: typeof body.title === 'string' ? body.title : undefined,
    assumptions: Array.isArray(body.assumptions) ? body.assumptions : undefined,
    user,
  })

  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess(result.value, 201)
})
