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
type RelatedRow = { id: string; [key: string]: unknown }

function timeValue(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

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
    .limit(1000)
    .get()

  const activities = snap.docs
    .map((d): RelatedRow => ({ id: d.id, ...d.data() }))
    .filter((activity) => activity.companyId === companyId)
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
    .slice(0, limit)

  return apiSuccess({ activities })
})
