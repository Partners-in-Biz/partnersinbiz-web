import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { generateInvoiceNumber } from '@/lib/invoices/invoice-number'
import { requireInvoiceAccess } from '@/lib/invoices/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { id } = await (ctx as RouteContext).params

  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  const source = access.data

  const invoiceNumber = await generateInvoiceNumber(source.orgId, source.clientDetails?.name ?? source.orgId)

  // Compute relative dueDate preserving payment terms offset
  let dueDate: any = null
  if (source.dueDate && source.issueDate) {
    const issueSec = source.issueDate._seconds ?? (source.issueDate.toDate ? source.issueDate.toDate().getTime() / 1000 : null)
    const dueSec = source.dueDate._seconds ?? (source.dueDate.toDate ? source.dueDate.toDate().getTime() / 1000 : null)
    if (issueSec && dueSec) {
      const offsetMs = (dueSec - issueSec) * 1000
      dueDate = Timestamp.fromDate(new Date(Date.now() + offsetMs))
    }
  }

  const doc = {
    orgId: source.orgId,
    invoiceNumber,
    status: 'draft' as const,
    issueDate: FieldValue.serverTimestamp(),
    dueDate,
    lineItems: source.lineItems,
    subtotal: source.subtotal,
    taxRate: source.taxRate,
    taxAmount: source.taxAmount,
    total: source.total,
    currency: source.currency,
    notes: source.notes ?? '',
    fromDetails: source.fromDetails ?? null,
    clientDetails: source.clientDetails ?? null,
    paidAt: null,
    sentAt: null,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const ref = await adminDb.collection('invoices').add(doc)
  return apiSuccess({ id: ref.id, invoiceNumber }, 201)
})
