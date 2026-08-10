/**
 * POST /api/v1/time-entries/bill
 *
 * Binds a batch of time entries to an invoice. Appends one line item per
 * entry onto the invoice and recomputes totals using the invoice's existing
 * `taxRate`.
 *
 * Body: `{ entryIds: string[], invoiceId: string }`
 *
 * Rules:
 *   - Invoice must exist.
 *   - All entries must exist, not be soft-deleted, not already be billed,
 *     and belong to the same org as the invoice.
 *   - Line item shape: { description, quantity (hours, 2dp), unitPrice, amount }
 *
 * Response: `apiSuccess({ billed, invoiceId, newTotal }, 200)`
 *
 * Auth: admin (AI/admin)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import { rejectGenericPartnerTradeMutation } from '@/lib/partner-links/invoice-guard'
import type { Invoice, LineItem } from '@/lib/invoices/types'
import type { TimeEntry } from '@/lib/time-tracking/types'

export const dynamic = 'force-dynamic'

interface BillBody {
  entryIds?: string[]
  invoiceId?: string
}

export const POST = withAuth('admin', async (req, user) => {
  const body = (await req.json()) as BillBody

  if (!body.invoiceId?.trim()) return apiError('invoiceId is required')
  if (!Array.isArray(body.entryIds) || body.entryIds.length === 0) {
    return apiError('entryIds must be a non-empty array')
  }

  const entryIds = Array.from(new Set(body.entryIds.map((s) => String(s).trim()).filter(Boolean)))
  if (entryIds.length === 0) return apiError('entryIds must contain at least one id')
  if (entryIds.length > 400) {
    return apiError('entryIds supports up to 400 ids per request')
  }

  const invoiceRef = adminDb.collection('invoices').doc(body.invoiceId.trim())
  const invoiceSnap = await invoiceRef.get()
  if (!invoiceSnap.exists) return apiError('Invoice not found', 404)
  const invoice = invoiceSnap.data() as Invoice | undefined
  if (!invoice) return apiError('Invoice not found', 404)
  const genericMutationError = rejectGenericPartnerTradeMutation(invoice as unknown as Record<string, unknown>)
  if (genericMutationError) return apiError(genericMutationError, 409)

  // Fetch entries (Firestore admin getAll handles duplicates fine).
  const entryRefs = entryIds.map((id) => adminDb.collection('time_entries').doc(id))
  const entryDocs = await adminDb.getAll(...entryRefs)

  const entries: Array<TimeEntry & { id: string }> = []
  for (const snap of entryDocs) {
    if (!snap.exists) return apiError(`Time entry ${snap.id} not found`, 404)
    const data = snap.data() as TimeEntry | undefined
    if (!data || data.deleted === true) {
      return apiError(`Time entry ${snap.id} not found`, 404)
    }
    if (data.invoiceId) {
      return apiError(
        `Time entry ${snap.id} is already billed on invoice ${data.invoiceId}`,
        409,
      )
    }
    if (invoice.orgId && data.orgId !== invoice.orgId) {
      return apiError(
        `Time entry ${snap.id} belongs to a different org than the invoice`,
        400,
      )
    }
    entries.push({ ...data, id: snap.id })
  }

  // Build new line items from the entries.
  const newLineItems: LineItem[] = entries.map((e) => {
    const hours = Math.round((e.durationMinutes / 60) * 100) / 100
    const unitPrice = e.hourlyRate ?? 0
    const amount = Math.round(hours * unitPrice * 100) / 100
    return {
      description: e.description,
      quantity: hours,
      unitPrice,
      amount,
    }
  })

  const existingLineItems: LineItem[] = Array.isArray(invoice.lineItems)
    ? invoice.lineItems
    : []
  const combinedLineItems = [...existingLineItems, ...newLineItems]

  const subtotal =
    Math.round(combinedLineItems.reduce((sum, li) => sum + Number(li.amount || 0), 0) * 100) / 100
  const taxRate = Number(invoice.taxRate ?? 0)
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100
  const total = Math.round((subtotal + taxAmount) * 100) / 100

  // Batch the updates: invoice + one entry per id.
  const batch = adminDb.batch()
  batch.update(invoiceRef, {
    lineItems: combinedLineItems,
    subtotal,
    taxAmount,
    total,
    updatedAt: FieldValue.serverTimestamp(),
  })

  for (const entry of entries) {
    batch.update(adminDb.collection('time_entries').doc(entry.id), {
      invoiceId: body.invoiceId!.trim(),
      ...lastActorFrom(user),
    })
  }

  await batch.commit()

  return apiSuccess({
    billed: entries.length,
    invoiceId: body.invoiceId!.trim(),
    newTotal: total,
  })
})
