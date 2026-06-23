/**
 * GET  /api/v1/email/list-health?orgId=... — list-health report (US-113)
 *   → health score, bucket breakdown, suggested actions, cleaning history.
 *
 * POST /api/v1/email/list-health — run a cleaning action.
 *   Body: { orgId?, action: 'suppress-inactive' }
 *   → suppresses inactive-180d contacts and records a cleaning-history entry.
 *
 * Auth: client (admin/ai must scope with ?orgId= / body.orgId).
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getListHealthReport, suppressInactiveContacts } from '@/lib/email-analytics/list-health'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId') ?? user.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const report = await getListHealthReport(scope.orgId)
  return apiSuccess(report)
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = (await req.json().catch(() => null)) as { orgId?: string; action?: string } | null
  if (!body) return apiError('Invalid JSON', 400)

  const requestedOrgId =
    typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : (user.orgId ?? null)
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const action = (body.action ?? '').trim()
  if (action !== 'suppress-inactive') {
    return apiError('Unsupported action. Supported: suppress-inactive', 400)
  }

  const result = await suppressInactiveContacts(scope.orgId, user.uid)
  return apiSuccess(result)
})
