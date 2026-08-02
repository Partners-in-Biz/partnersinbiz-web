/**
 * GET /api/v1/crm/contacts/[id]/graph
 * Graph-safe neighbour expansion for Hermes CRM tools.
 * Always returns neighbour IDs the system already knows.
 *
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
import { loadContactGraph } from '@/lib/crm/facts'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

async function assertContactAccess(
  ctx: CrmAuthContext,
  contactId: string,
): Promise<{ ok: true } | { ok: false; res: Response }> {
  const snap = await adminDb.collection('contacts').doc(contactId).get()
  if (!snap.exists) return { ok: false, res: apiError('Contact not found', 404) }
  const data = snap.data()!
  if (data.orgId !== ctx.orgId || data.deleted === true) {
    return { ok: false, res: apiError('Contact not found', 404) }
  }
  if (!isCrmPrivilegedActor(ctx)) {
    const companies = await loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(data))
    if (!crmActorCanReadRecord(ctx, { id: snap.id, ...data }, { companies })) {
      return { ok: false, res: apiError('Contact not found', 404) }
    }
  }
  return { ok: true }
}

export const GET = withCrmAuth<RouteCtx>('member', async (req, ctx, routeCtx) => {
  const { id: contactId } = await routeCtx!.params
  if (!contactId) return apiError('Contact ID is required', 400)

  const access = await assertContactAccess(ctx, contactId)
  if (!access.ok) return access.res

  const url = new URL(req.url)
  const graph = await loadContactGraph({
    orgId: ctx.orgId,
    contactId,
    includeFacts: url.searchParams.get('includeFacts') !== 'false',
    includeResearchTasks: url.searchParams.get('includeResearchTasks') === 'true',
    activityLimit: Number(url.searchParams.get('activityLimit') || '10'),
    dealLimit: Number(url.searchParams.get('dealLimit') || '25'),
  })

  if (!graph) return apiError('Contact not found', 404)
  return apiSuccess({ graph })
})
