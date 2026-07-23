/**
 * POST /api/v1/crm/contacts/:id/send-sms
 *
 * Send a direct SMS to a contact and log a CRM activity.
 * Auth: member+
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { sendSmsToContact } from '@/lib/sms/send'
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

export const POST = withCrmAuth<RouteCtx>(
  'member',
  async (req: NextRequest, ctx, routeCtx) => {
    const { id } = await routeCtx!.params

    // ── Parse + validate body ─────────────────────────────────────────────────
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return apiError('Invalid JSON body', 400)
    }

    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) return apiError('message is required', 400)

    // ── Fetch + verify contact (org + owned/linked) ──────────────────────────
    const access = await loadAccessibleContact(ctx, id)
    if (!access.ok) return access.res
    const contact = access.contact

    if (!contact.phone) return apiError('Contact has no phone number', 400)

    // ── Send through shared SMS pipeline ──────────────────────────────────────
    // This keeps one-off CRM sends behind the same preferences, suppression,
    // frequency-cap, audit-doc, and Twilio-safe-failure behaviour as sequences
    // and broadcasts. Do not bypass this with a direct Twilio send.
    const result = await sendSmsToContact({
      orgId: ctx.orgId,
      contactId: id,
      body: message,
      topicId: 'transactional',
    })

    if (result.status === 'failed') {
      return apiError(result.reason ?? 'SMS send failed', 502)
    }

    if (result.status === 'skipped') {
      return apiSuccess({ sent: false, status: 'skipped', reason: result.reason })
    }

    return apiSuccess({
      sent: true,
      status: 'sent',
      smsId: result.smsId,
      twilioSid: result.twilioSid,
      segmentsCount: result.segmentsCount,
    })
  },
)
