/**
 * POST /api/v1/crm/contacts/:id/send-sms
 *
 * Send a direct SMS to a contact and log a CRM activity.
 * Auth: member+
 */
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { sendSms } from '@/lib/sms/twilio'

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

    // ── Send SMS ──────────────────────────────────────────────────────────────
    const result = await sendSms({ to: contact.phone as string, body: message })
    if (!result.ok) {
      return apiError(result.error ?? 'SMS send failed', 500)
    }

    // ── Log CRM activity + update lastContactedAt (best-effort) ──────────────
    try {
      const actorRef = ctx.actor
      const batch = adminDb.batch()

      const activityRef = adminDb.collection('activities').doc()
      batch.set(activityRef, {
        orgId: ctx.orgId,
        contactId: id,
        type: 'sms_sent',
        summary: message,
        createdByRef: actorRef,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        deleted: false,
      })

      batch.update(docRef, {
        lastContactedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })

      await batch.commit()
    } catch (err) {
      console.error('[send-sms] activity/lastContactedAt write failed (non-blocking)', err)
    }

    return apiSuccess({ sent: true })
  },
)
