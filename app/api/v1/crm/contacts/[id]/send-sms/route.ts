/**
 * POST /api/v1/crm/contacts/:id/send-sms
 *
 * Send a direct SMS to a contact and log a CRM activity.
 * Auth: member+
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { sendSmsToContact } from '@/lib/sms/send'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

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

    // ── Fetch + verify contact ────────────────────────────────────────────────
    const docRef = adminDb.collection('contacts').doc(id)
    const snap = await docRef.get()
    if (!snap.exists) return apiError('Contact not found', 404)
    const contact = snap.data()!
    if (contact.orgId !== ctx.orgId) return apiError('Contact not found', 404)

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
