/**
 * POST /api/v1/invoices/[id]/send — transition an invoice from draft → sent
 *
 * Side effects:
 *  - Sets `status='sent'`, `sentAt=serverTimestamp()`
 *  - Generates a `publicToken` (32-char hex) if not already set
 *  - Emails the invoice to `clientDetails.email` via Resend
 *  - Logs errors but always returns success if the Firestore update succeeded
 *
 * Auth: admin (ai satisfies).
 */
import crypto from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { getResendClient, FROM_ADDRESS } from '@/lib/email/resend'
import { invoiceSentEmail } from '@/lib/email/templates'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { logActivity } from '@/lib/activity/log'
import { requireInvoiceAccess } from '@/lib/invoices/access'
import { canManageOrgAs } from '@/lib/orgMembers/permissions'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'https://partnersinbiz.online'

export const POST = withAuth('client', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  const ref = access.ref
  const invoice = access.data
  const sourceOrgId: string | undefined = invoice.sourceOrgId ?? invoice.orgId
  if (!sourceOrgId || !(await canManageOrgAs(user, sourceOrgId))) {
    return apiError('Forbidden', 403)
  }

  if (invoice.status !== 'draft') {
    return apiError(`Invoice cannot be sent from status '${invoice.status}'`, 400)
  }

  const publicToken = invoice.publicToken ?? crypto.randomBytes(16).toString('hex')

  const updates: Record<string, unknown> = {
    status: 'sent',
    sentAt: FieldValue.serverTimestamp(),
    publicToken,
    ...lastActorFrom(user),
  }
  await ref.update(updates)

  logActivity({
    orgId: invoice.orgId,
    type: 'invoice_sent',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Sent invoice to client',
    entityId: id,
    entityType: 'invoice',
    entityTitle: invoice.invoiceNumber ?? undefined,
  }).catch(() => {})

  // Email the client — swallow failures, DB update already succeeded.
  const clientEmail: string | undefined = invoice.clientDetails?.email ?? invoice.recipientEmail
  if (clientEmail) {
    try {
      const invoiceNumber: string = invoice.invoiceNumber ?? id
      const total = new Intl.NumberFormat('en', {
        style: 'currency',
        currency: invoice.currency ?? 'USD',
      }).format(invoice.total ?? 0)
      const dueDate = invoice.dueDate?._seconds
        ? new Date(invoice.dueDate._seconds * 1000).toLocaleDateString('en-ZA', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : 'N/A'
      const viewUrl = `${PUBLIC_BASE_URL}/invoice/${publicToken}`
      const html = invoiceSentEmail(
        invoiceNumber,
        total,
        dueDate,
        invoice.clientDetails?.name ?? 'there',
        viewUrl,
      )
      const pdfUrl = `${PUBLIC_BASE_URL}/api/v1/invoices/${id}/pdf`
      const htmlWithPdf = html.replace(
        '</a>',
        `</a><p style="color:rgba(255,255,255,0.4); font-size:11px; margin-top:12px;">Download PDF: <a href="${pdfUrl}" style="color:#F59E0B;">${pdfUrl}</a></p>`,
      )

      await getResendClient().emails.send({
        from: FROM_ADDRESS,
        to: clientEmail,
        subject: `Invoice ${invoiceNumber}`,
        html: htmlWithPdf,
      })
    } catch (err) {
      console.error('[invoices/send] email failed:', err)
    }
  }

  const orgId: string | undefined = invoice.orgId
  if (orgId) {
    try {
      await dispatchWebhook(orgId, 'invoice.sent', {
        id,
        invoiceNumber: invoice.invoiceNumber ?? id,
        total: invoice.total,
        currency: invoice.currency ?? 'USD',
        clientEmail: invoice.clientDetails?.email ?? null,
        dueDate: invoice.dueDate ?? null,
        publicViewUrl: `${PUBLIC_BASE_URL}/invoice/${publicToken}`,
      })
    } catch (err) {
      console.error('[webhook-dispatch-error] invoice.sent', err)
    }
  }

  return apiSuccess({ id, status: 'sent', sentAt: new Date().toISOString() })
})
