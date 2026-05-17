// app/api/v1/crm/companies/[id]/quotes/route.ts
// GET /api/v1/crm/companies/:id/quotes — list quotes linked to a company
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { loadCompany } from '@/lib/companies/store'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export const GET = withCrmAuth<RouteCtx>('viewer', async (req, ctx, routeCtx) => {
  const { id: companyId } = await routeCtx!.params

  const company = await loadCompany(companyId, ctx.orgId)
  if (!company) return apiError('Not found', 404)

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)

  const snap = await adminDb
    .collection('quotes')
    .where('orgId', '==', ctx.orgId)
    .where('companyId', '==', companyId)
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get()

  const quotes = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  return apiSuccess({ quotes })
})
