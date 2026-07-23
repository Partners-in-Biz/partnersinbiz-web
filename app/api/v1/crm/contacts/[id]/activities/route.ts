/**
 * GET /api/v1/crm/contacts/:id/activities
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { Activity } from '@/lib/crm/types'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
} from '@/lib/crm/assignment-access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function loadAccessibleContact(
  ctx: CrmAuthContext,
  contactId: string,
): Promise<{ ok: true; contact: Record<string, unknown> } | { ok: false; res: Response }> {
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
  return { ok: true, contact: { id: snap.id, ...data } }
}

export const GET = withCrmAuth<RouteContext>(
  'viewer',
  async (_req, ctx, routeCtx) => {
    const { id } = await routeCtx!.params

    const access = await loadAccessibleContact(ctx, id)
    if (!access.ok) return access.res

    const snapshot = await adminDb
      .collection('activities')
      .where('orgId', '==', ctx.orgId)
      .where('contactId', '==', id)
      .orderBy('createdAt', 'desc')
      .get()

    const activities: Activity[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Activity, 'id'>),
    }))

    return apiSuccess(activities)
  },
)
