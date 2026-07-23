import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listContactDocuments, type ContactLinkSubject } from '@/lib/companies/command-center'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
} from '@/lib/crm/assignment-access'

type RouteCtx = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

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

export const GET = withCrmAuth<RouteCtx>(
  'viewer',
  async (req, ctx, routeCtx) => {
    const { id } = await routeCtx!.params
    const access = await loadAccessibleContact(ctx, id)
    if (!access.ok) return access.res

    const contact = access.contact as ContactLinkSubject
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? '50') || 50, 1), 200)
    const documents = await listContactDocuments(contact, { limit })
    return apiSuccess({ documents })
  },
)
