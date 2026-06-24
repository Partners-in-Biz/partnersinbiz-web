/**
 * POST /api/v1/crm/contacts/:id/send-email
 *
 * Send a direct email to a contact and log a CRM activity.
 * Auth: member+
 */
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { sendEmail } from '@/lib/email/send'
import { isSuppressed } from '@/lib/email/suppressions'

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

    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const bodyText = typeof body.bodyText === 'string' ? body.bodyText.trim() : ''
    const bodyHtml = typeof body.bodyHtml === 'string' ? body.bodyHtml : undefined

    if (!subject) return apiError('subject is required', 400)
    if (!bodyText) return apiError('bodyText is required', 400)

    // ── Fetch + verify contact ────────────────────────────────────────────────
    const docRef = adminDb.collection('contacts').doc(id)
    const snap = await docRef.get()
    if (!snap.exists) return apiError('Contact not found', 404)
    const contact = snap.data()!
    if (contact.orgId !== ctx.orgId) return apiError('Contact not found', 404)

    if (!contact.email) return apiError('Contact has no email address', 400)

    // ── Suppression check (US-076) ────────────────────────────────────────────
    // Don't email contacts on the org's suppression list (unsubscribes, hard
    // bounces, complaints). Mirrors the marketing send pipeline's guard.
    if (await isSuppressed(ctx.orgId, contact.email as string, 'email')) {
      return apiError(
        'This contact is on the suppression list (unsubscribed or bounced) and cannot be emailed',
        422,
      )
    }

    // ── Send email ────────────────────────────────────────────────────────────
    const html = bodyHtml ?? bodyText.replace(/\n/g, '<br/>')
    const result = await sendEmail({ to: contact.email as string, subject, html })
    if (!result.success) {
      return apiError(result.error ?? 'Email send failed', 500)
    }

    // ── Log CRM activity + update lastContactedAt (best-effort) ──────────────
    try {
      const actorRef = ctx.actor
      const batch = adminDb.batch()

      const activityRef = adminDb.collection('activities').doc()
      batch.set(activityRef, {
        orgId: ctx.orgId,
        contactId: id,
        type: 'email_sent',
        summary: subject,
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
      console.error('[send-email] activity/lastContactedAt write failed (non-blocking)', err)
    }

    return apiSuccess({ sent: true })
  },
)
