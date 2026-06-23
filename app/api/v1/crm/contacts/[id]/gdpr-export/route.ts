/**
 * GET /api/v1/crm/contacts/:id/gdpr-export
 *
 * Returns a STRUCTURED archive of all data held for a contact — for GDPR
 * Subject Access Request (SAR) compliance. The caller downloads this via the
 * contact detail page UI.
 *
 * Sections: { contact, notes, activity, emailHistory, formSubmissions }
 * Every query is org + contact scoped.
 *
 * Auth: viewer+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { LEAD_CAPTURE_SUBMISSIONS } from '@/lib/lead-capture/types'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
} from '@/lib/crm/assignment-access'

type RouteCtx = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

const CONTACT_NOTES = 'contact_notes'

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

function millis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const c = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof c.toMillis === 'function') return c.toMillis()
    if (typeof c.toDate === 'function') return c.toDate().getTime()
    if (typeof c.seconds === 'number') return c.seconds * 1000
    if (typeof c._seconds === 'number') return c._seconds * 1000
  }
  return 0
}

/**
 * Runs an org + contact scoped collection query, drops soft-deleted rows, and
 * sorts newest-first. Never throws — an empty section is acceptable in an export.
 */
async function loadSection(
  collection: string,
  orgId: string,
  contactId: string,
): Promise<Record<string, unknown>[]> {
  try {
    const snap = await adminDb
      .collection(collection)
      .where('orgId', '==', orgId)
      .where('contactId', '==', contactId)
      .get()
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>)
      .filter((row) => row.deleted !== true)
      .sort((a, b) => millis(b.createdAt) - millis(a.createdAt))
  } catch (err) {
    console.error(`[gdpr-export] section "${collection}" failed`, err)
    return []
  }
}

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

    // Pull every section in parallel — each is org + contact scoped.
    const [notes, activity, emailHistory, formSubmissions] = await Promise.all([
      loadSection(CONTACT_NOTES, ctx.orgId, id),
      loadSection('activities', ctx.orgId, id),
      loadSection('emails', ctx.orgId, id),
      loadSection(LEAD_CAPTURE_SUBMISSIONS, ctx.orgId, id),
    ])

    return apiSuccess({
      contact,
      notes,
      activity,
      emailHistory,
      formSubmissions,
      exportedAt: new Date().toISOString(),
      fields: CONTACT_FIELDS,
      counts: {
        notes: notes.length,
        activity: activity.length,
        emailHistory: emailHistory.length,
        formSubmissions: formSubmissions.length,
      },
    })
  },
)
