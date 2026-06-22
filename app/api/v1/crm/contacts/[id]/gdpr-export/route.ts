/**
 * GET /api/v1/crm/contacts/:id/gdpr-export
 *
 * Returns a JSON blob of all data held for a contact — for GDPR Subject
 * Access Request (SAR) compliance. The caller downloads this via the
 * contact detail page UI.
 *
 * Auth: viewer+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
} from '@/lib/crm/assignment-access'

type RouteCtx = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

// Human-readable list of the top-level fields held for a contact.
const CONTACT_FIELDS: string[] = [
  'id',
  'orgId',
  'name',
  'email',
  'phone',
  'company',
  'companyId',
  'companyName',
  'jobTitle',
  'department',
  'website',
  'timezone',
  'source',
  'type',
  'stage',
  'tags',
  'notes',
  'assignedTo',
  'leadScore',
  'icpScore',
  'aiLeadScore',
  'phoneVerified',
  'smsOptedIn',
  'unsubscribedAt',
  'bouncedAt',
  'smsUnsubscribedAt',
  'lastContactedAt',
  'lastRepliedAt',
  'repliesCount',
  'createdAt',
  'updatedAt',
  'customFields',
]

export const GET = withCrmAuth<RouteCtx>(
  'viewer',
  async (_req, ctx, routeCtx) => {
    const { id } = await routeCtx!.params
    const docRef = adminDb.collection('contacts').doc(id)
    const snap = await docRef.get()

    if (!snap.exists) return apiError('Contact not found', 404)

    const data = snap.data()!
    if (data.orgId !== ctx.orgId || data.deleted === true) {
      return apiError('Contact not found', 404)
    }

    // Enforce row-level access for non-privileged actors
    if (!isCrmPrivilegedActor(ctx)) {
      const companies = await loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(data))
      if (!crmActorCanReadRecord(ctx, { id: snap.id, ...data }, { companies })) {
        return apiError('Contact not found', 404)
      }
    }

    const contact = { id: snap.id, ...data }

    return apiSuccess({
      contact,
      exportedAt: new Date().toISOString(),
      fields: CONTACT_FIELDS,
    })
  },
)
