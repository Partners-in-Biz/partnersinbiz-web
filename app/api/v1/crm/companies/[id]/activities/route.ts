/**
 * GET /api/v1/crm/companies/:id/activities — list activities linked to a company
 *
 * Auth: viewer+
 * Query params: limit (default 50, max 200)
 * Sorted: createdAt desc
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { loadCompany } from '@/lib/companies/store'

type RouteCtx = { params: Promise<{ id: string }> }

export const GET = withCrmAuth<RouteCtx>('viewer', async (req, ctx, routeCtx) => {
  const { id: companyId } = await routeCtx!.params

  // Tenant-safety: loadCompany returns null on cross-tenant + soft-deleted
  const company = await loadCompany(companyId, ctx.orgId)
  if (!company) return apiError('Not found', 404)

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)

  const snap = await adminDb
    .collection('activities')
    .where('orgId', '==', ctx.orgId)
    .where('companyId', '==', companyId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()

  const activities = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

  return apiSuccess({ activities })
})
