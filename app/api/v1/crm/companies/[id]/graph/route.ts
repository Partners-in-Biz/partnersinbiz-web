/**
 * GET /api/v1/crm/companies/[id]/graph
 * Graph-safe company neighbour expansion — every neighbour includes id.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  crmActorCanReadRecord,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
} from '@/lib/crm/assignment-access'
import { loadCompanyGraph } from '@/lib/crm/facts'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

async function assertCompanyAccess(
  ctx: CrmAuthContext,
  companyId: string,
): Promise<{ ok: true } | { ok: false; res: Response }> {
  const snap = await adminDb.collection('companies').doc(companyId).get()
  if (!snap.exists) return { ok: false, res: apiError('Company not found', 404) }
  const data = snap.data()!
  if (data.orgId !== ctx.orgId || data.deleted === true) {
    return { ok: false, res: apiError('Company not found', 404) }
  }
  if (!isCrmPrivilegedActor(ctx)) {
    const companies = await loadCompanyAssignmentMap(ctx.orgId, [companyId])
    if (!crmActorCanReadRecord(ctx, { id: snap.id, ...data }, { companies })) {
      return { ok: false, res: apiError('Company not found', 404) }
    }
  }
  return { ok: true }
}

export const GET = withCrmAuth<RouteCtx>('member', async (req, ctx, routeCtx) => {
  const { id: companyId } = await routeCtx!.params
  if (!companyId) return apiError('Company ID is required', 400)

  const access = await assertCompanyAccess(ctx, companyId)
  if (!access.ok) return access.res

  const url = new URL(req.url)
  const graph = await loadCompanyGraph({
    orgId: ctx.orgId,
    companyId,
    contactLimit: Number(url.searchParams.get('contactLimit') || '50'),
    dealLimit: Number(url.searchParams.get('dealLimit') || '50'),
  })

  if (!graph) return apiError('Company not found', 404)
  return apiSuccess({ graph })
})
