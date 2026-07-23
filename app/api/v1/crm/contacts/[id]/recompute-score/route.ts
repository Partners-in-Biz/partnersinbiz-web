/**
 * POST /api/v1/crm/contacts/:id/recompute-score — manually recompute scores
 * for a single contact (admin+).
 *
 * Body: { includeAi?: boolean }   defaults to true
 *
 * Returns the ScoreUpdate on success, 404 if contact not found / cross-tenant.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { computeScoresForContact } from '@/lib/scoring/compute'
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

export const POST = withCrmAuth<RouteContext>(
  'admin',
  async (req, ctx, routeCtx) => {
    const { id } = await routeCtx!.params

    // Verify contact exists, belongs to this org, and actor can read it
    const access = await loadAccessibleContact(ctx, id)
    if (!access.ok) return access.res

    // Parse optional body
    let includeAi = true
    const bodyText = await req.text()
    if (bodyText && bodyText.trim() !== '') {
      try {
        const parsed = JSON.parse(bodyText)
        if (typeof parsed?.includeAi === 'boolean') {
          includeAi = parsed.includeAi
        }
      } catch {
        return apiError('Invalid JSON', 400)
      }
    }

    // Compute scores
    const update = await computeScoresForContact(ctx.orgId, id, {
      includeAi,
      actor: ctx.actor,
    })

    if (update === null) {
      return apiError('Contact not found or cross-tenant', 404)
    }

    return apiSuccess({ update })
  },
)
