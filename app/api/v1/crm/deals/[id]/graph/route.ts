/**
 * GET /api/v1/crm/deals/[id]/graph
 * Graph-safe deal neighbour expansion — contact/company always include ids.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
} from '@/lib/crm/assignment-access'
import { loadDealGraph } from '@/lib/crm/facts'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

async function assertDealAccess(
  ctx: CrmAuthContext,
  dealId: string,
): Promise<{ ok: true } | { ok: false; res: Response }> {
  const snap = await adminDb.collection('deals').doc(dealId).get()
  if (!snap.exists) return { ok: false, res: apiError('Deal not found', 404) }
  const data = snap.data()!
  if (data.orgId !== ctx.orgId || data.deleted === true) {
    return { ok: false, res: apiError('Deal not found', 404) }
  }
  if (!isCrmPrivilegedActor(ctx)) {
    const companies = await loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(data))
    if (!crmActorCanReadRecord(ctx, { id: snap.id, ...data }, { companies })) {
      return { ok: false, res: apiError('Deal not found', 404) }
    }
  }
  return { ok: true }
}

export const GET = withCrmAuth<RouteCtx>('member', async (_req, ctx, routeCtx) => {
  const { id: dealId } = await routeCtx!.params
  if (!dealId) return apiError('Deal ID is required', 400)

  const access = await assertDealAccess(ctx, dealId)
  if (!access.ok) return access.res

  const graph = await loadDealGraph({
    orgId: ctx.orgId,
    dealId,
  })

  if (!graph) return apiError('Deal not found', 404)
  return apiSuccess({ graph })
})
