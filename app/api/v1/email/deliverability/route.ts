/**
 * GET /api/v1/email/deliverability?orgId=... — deliverability dashboard data (US-111)
 *
 * Returns reputation score, 30d bounce/complaint/delivery rates, a live DNSBL
 * blacklist check, per-domain SPF/DKIM/DMARC status, alerts, and
 * recommendations.
 *
 * Auth: client (admin/ai must scope with ?orgId=).
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getDeliverabilityReport } from '@/lib/email-analytics/deliverability'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'
// DNSBL lookups + analytics aggregation can take a few seconds.
export const maxDuration = 30

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId') ?? user.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const report = await getDeliverabilityReport(scope.orgId)
  return apiSuccess(report)
})
