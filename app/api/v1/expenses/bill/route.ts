/**
 * POST /api/v1/expenses/bill — attach a batch of approved, billable expenses
 * to an invoice.
 *
 * Body: { expenseIds: string[], invoiceId: string }
 *
 * Each expense must be `billable: true`, status `approved`, and not yet billed
 * (invoiceId === null). Adds a line item per expense, recomputes invoice
 * totals, and sets invoiceId on each expense in a batched write.
 *
 * Auth: admin (AI/admin)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import { rejectGenericPartnerTradeMutation } from '@/lib/partner-links/invoice-guard'
import type { Expense } from '@/lib/expenses/types'

export const dynamic = 'force-dynamic'

interface InvoiceLineItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export const POST = withAuth('admin', async (req, user) => {
  const body = (await req.json().catch(() => ({}))) as {
    expenseIds?: unknown
    invoiceId?: unknown
  }

  if (!Array.isArray(body.expenseIds) || body.expenseIds.length === 0) {
    return apiError('expenseIds must be a non-empty array of expense ids')
  }
  if (typeof body.invoiceId !== 'string' || !body.invoiceId.trim()) {
    return apiError('invoiceId is required')
  }

  const expenseIds = body.expenseIds.filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  )
  if (expenseIds.length === 0) {
    return apiError('expenseIds must contain at least one non-empty string')
  }

  const invoiceId = body.invoiceId.trim()
  const invoiceRef = adminDb.collection('invoices').doc(invoiceId)
  const invoiceDoc = await invoiceRef.get()
  if (!invoiceDoc.exists) return apiError('Invoice not found', 404)
  const invoice = invoiceDoc.data() as Record<string, unknown>
  const genericMutationError = rejectGenericPartnerTradeMutation(invoice)
  if (genericMutationError) return apiError(genericMutationError, 409)

  // Load + validate every expense up-front; fail fast before any writes.
  const expenseRefs = expenseIds.map((id) =>
    adminDb.collection('expenses').doc(id),
  )
  const expenseDocs = await adminDb.getAll(...expenseRefs)

  const expenses: Array<{ id: string; data: Expense }> = []
  for (const snap of expenseDocs) {
    if (!snap.exists) {
      return apiError(`Expense '${snap.id}' not found`, 404)
    }
    const data = snap.data() as Expense
    if (data.deleted === true) {
      return apiError(`Expense '${snap.id}' not found`, 404)
    }
    if (!data.billable) {
      return apiError(`Expense '${snap.id}' is not marked billable`, 409)
    }
    if (data.status !== 'approved') {
      return apiError(
        `Expense '${snap.id}' must be approved before billing (current: ${data.status})`,
        409,
      )
    }
    if (data.invoiceId) {
      return apiError(
        `Expense '${snap.id}' has already been billed to invoice '${data.invoiceId}'`,
        409,
      )
    }
    expenses.push({ id: snap.id, data })
  }

  // Build new line items.
  const newLineItems: InvoiceLineItem[] = expenses.map(({ data }) => {
    const desc = `${data.category}${data.description ? `: ${data.description}` : ''}`
    return {
      description: desc,
      quantity: 1,
      unitPrice: data.amount,
      amount: data.amount,
    }
  })

  const existingLineItems = Array.isArray(invoice.lineItems)
    ? (invoice.lineItems as InvoiceLineItem[])
    : []
  const mergedLineItems = [...existingLineItems, ...newLineItems]

  // Recompute totals. Preserve existing taxRate; default 0 if missing.
  const subtotal = mergedLineItems.reduce(
    (sum, item) => sum + Number(item.amount ?? 0),
    0,
  )
  const taxRate = Number(invoice.taxRate ?? 0)
  const taxAmount = subtotal * (taxRate / 100)
  const total = subtotal + taxAmount

  // Batched write: invoice update + expense updates.
  const batch = adminDb.batch()
  batch.update(invoiceRef, {
    lineItems: mergedLineItems,
    subtotal,
    taxAmount,
    total,
    updatedAt: FieldValue.serverTimestamp(),
  })

  for (const { id } of expenses) {
    batch.update(adminDb.collection('expenses').doc(id), {
      invoiceId,
      ...lastActorFrom(user),
    })
  }

  await batch.commit()

  return apiSuccess({
    billed: expenses.length,
    invoiceId,
    newTotal: total,
  })
})
