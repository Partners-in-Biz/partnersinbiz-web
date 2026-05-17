/**
 * GET /api/v1/crm/companies/:id/contacts
 *
 * Returns all contacts linked to this company via companyId (within the caller's org).
 * Auth: viewer+
 * Query params: limit (default 50, max 200)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { loadCompany } from '@/lib/companies/store'

type RouteCtx = { params: Promise<{ id: string }> }

export const GET = withCrmAuth<RouteCtx>(
  'viewer',
  async (req, ctx, routeCtx) => {
    const { id: companyId } = await routeCtx!.params

    // Tenant-safety: ensure company belongs to caller's org (returns null on cross-tenant + deleted)
    const company = await loadCompany(companyId, ctx.orgId)
    if (!company) return apiError('Not found', 404)

    const url = new URL(req.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)

    const snap = await adminDb
      .collection('contacts')
      .where('orgId', '==', ctx.orgId)
      .where('companyId', '==', companyId)
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get()

    const contacts = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

    return apiSuccess({ contacts })
  },
)
