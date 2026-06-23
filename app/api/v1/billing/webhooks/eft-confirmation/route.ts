/**
 * POST /api/v1/billing/webhooks/eft-confirmation
 *
 * INTERNAL EFT-confirmation hook. This is the EFT adaptation of what would be a
 * card-processor webhook on a Stripe stack — there is no Stripe here. An
 * internal trusted system (bank-reconciliation job, ops tool, or an agent)
 * calls this once an EFT payment is matched to an invoice.
 *
 * Auth: PUBLIC route (NOT `withAuth`) — verifies a shared secret header
 * `x-pib-webhook-secret` compared constant-time against `EFT_WEBHOOK_SECRET`.
 *
 * Body: { invoiceId: string, reference?: string, amount?: number, paidAt?: ISO }
 *
 * Drives the invoice to paid via EFT (reuses the shared settle logic), advances
 * the linked subscription to active. Idempotent — a re-confirmation of an
 * already-paid invoice is a no-op. Records the event in `webhook_events`.
 *
 * Env: EFT_WEBHOOK_SECRET (required).
 */
import { createHash, timingSafeEqual } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { apiSuccess, apiError } from '@/lib/api/response'
import { settleInvoicePaid } from '@/lib/billing/settle-invoice'

export const dynamic = 'force-dynamic'

/** Constant-time secret comparison via SHA-256 digests (equal length). */
function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

interface EftBody {
  invoiceId?: string
  reference?: string
  amount?: number
  paidAt?: string
}

export async function POST(req: Request) {
  const expected = process.env.EFT_WEBHOOK_SECRET
  if (!expected) {
    console.error('[eft-confirmation] EFT_WEBHOOK_SECRET is not configured — rejecting')
    return apiError('EFT confirmation hook is not configured', 503)
  }

  if (!secretMatches(req.headers.get('x-pib-webhook-secret'), expected)) {
    return apiError('Unauthorized', 401)
  }

  let body: EftBody
  try {
    body = ((await req.json()) as EftBody) ?? {}
  } catch {
    return apiError('Unparseable body', 400)
  }

  const invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId.trim() : ''
  if (!invoiceId) return apiError('invoiceId is required', 400)

  const reference = typeof body.reference === 'string' ? body.reference : null
  const amount = typeof body.amount === 'number' ? body.amount : null

  let paidAt: Date | null = null
  if (typeof body.paidAt === 'string' && body.paidAt.trim()) {
    const parsed = new Date(body.paidAt)
    if (!Number.isNaN(parsed.getTime())) paidAt = parsed
  }

  const result = await settleInvoicePaid({
    invoiceId,
    paymentMethod: 'eft',
    paymentReference: reference,
    paidAmount: amount,
    paidAt,
    actorId: 'eft-webhook',
    actorName: 'EFT Confirmation',
    actorRole: 'system',
  })

  if (result.notFound) {
    return apiError('Invoice not found', 404)
  }

  // --- Record the event (idempotency / audit ledger) --------------------
  const eventKey = reference
    ? `eft:${invoiceId}:${reference}`
    : `eft:${invoiceId}:${Date.now()}`
  await adminDb
    .collection('webhook_events')
    .doc(eventKey)
    .set({
      provider: 'eft',
      eventId: eventKey,
      eventType: 'eft.confirmation',
      invoiceId,
      reference: reference ?? null,
      alreadyPaid: result.alreadyPaid,
      settled: result.ok && !result.alreadyPaid,
      processedAt: FieldValue.serverTimestamp(),
    })

  return apiSuccess({
    invoiceId,
    status: 'paid',
    alreadyPaid: result.alreadyPaid,
    subscriptionAdvanced: result.subscriptionAdvanced ?? false,
  })
}
