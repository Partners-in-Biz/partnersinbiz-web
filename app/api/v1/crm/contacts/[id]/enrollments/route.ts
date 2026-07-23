/**
 * GET /api/v1/crm/contacts/:id/enrollments — list enrollments for contact (member+)
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listEnrollments } from '@/lib/sequences/enrollment'
import { getSequence } from '@/lib/sequences/store'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
} from '@/lib/crm/assignment-access'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

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

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth<RouteCtx>('member', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  const access = await loadAccessibleContact(ctx, id)
  if (!access.ok) return access.res

  try {
    const enrollments = await listEnrollments(ctx.orgId, { contactId: id })

    // Enrich with sequence names — enrollment docs only store sequenceId, but
    // the contact panel needs a human-readable label per row.
    const sequenceIds = [...new Set(enrollments.map((e) => e.sequenceId).filter(Boolean))]
    const names = new Map<string, string>()
    await Promise.all(sequenceIds.map(async (sequenceId) => {
      const sequence = await getSequence(ctx.orgId, sequenceId)
      if (sequence?.name) names.set(sequenceId, sequence.name)
    }))

    return apiSuccess({
      enrollments: enrollments.map((e) => ({
        ...e,
        sequenceName: names.get(e.sequenceId) ?? '',
      })),
    })
  } catch (err) {
    console.error('[contact-enrollments-list-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
