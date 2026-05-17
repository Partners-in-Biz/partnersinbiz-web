/**
 * GET /api/v1/crm/companies/:id/deals — list deals linked to a company
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { loadCompany } from '@/lib/companies/store'

type RouteCtx = { params: Promise<{ id: string }> }

export const GET = withCrmAuth<RouteCtx>('viewer', async (req, ctx, routeCtx) => {
  const { id: companyId } = await routeCtx!.params
  const company = await loadCompany(companyId, ctx.orgId)
  if (!company) return apiError('Not found', 404)

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)

  const snap = await adminDb.collection('deals')
    .where('orgId', '==', ctx.orgId)
    .where('companyId', '==', companyId)
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get()

  const deals = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => d.deleted !== true)

  return apiSuccess({ deals })
})
