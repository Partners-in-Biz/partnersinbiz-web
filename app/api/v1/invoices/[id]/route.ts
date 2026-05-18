import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { notifyInvoiceSent } from '@/lib/notifications/notify'
import { logActivity } from '@/lib/activity/log'
import { tryAttributeInvoicePaid } from '@/lib/email-analytics/attribution-hooks'
import { requireInvoiceAccess } from '@/lib/invoices/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  return apiSuccess({ id: access.snap.id, ...access.data })
})

export const PATCH = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))
  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  const ref = access.ref
  const doc = access.snap

  // Recalculate totals if line items changed
  let updates: Record<string, any> = { ...body, updatedAt: FieldValue.serverTimestamp() }
  if (body.lineItems) {
    const lineItems = body.lineItems.map((item: any) => ({
      ...item,
      amount: Number(item.quantity) * Number(item.unitPrice),
    }))
    const subtotal = lineItems.reduce((sum: number, item: any) => sum + item.amount, 0)
    const taxRate = Number(body.taxRate ?? doc.data()?.taxRate ?? 0)
    const taxAmount = subtotal * (taxRate / 100)
    updates = { ...updates, lineItems, subtotal, taxRate, taxAmount, total: subtotal + taxAmount }
  }

  // Handle status transitions
  const flippedToPaid = body.status === 'paid' && doc.data()?.status !== 'paid'
  if (flippedToPaid) {
    updates.paidAt = FieldValue.serverTimestamp()
  }
  if (body.status === 'sent' && doc.data()?.status === 'draft') {
    updates.sentAt = FieldValue.serverTimestamp()
  }

  await ref.update(updates)

  const invoiceOrgId = doc.data()?.orgId
  if (invoiceOrgId) {
    logActivity({
      orgId: invoiceOrgId,
      type: 'invoice_updated',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Updated invoice',
      entityId: id,
      entityType: 'invoice',
      entityTitle: doc.data()?.invoiceNumber ?? undefined,
    }).catch(() => {})
  }

  // Best-effort revenue attribution when an invoice flips to paid via PATCH.
  if (flippedToPaid) {
    const data = doc.data() ?? {}
    await tryAttributeInvoicePaid({
      orgId: typeof data.orgId === 'string' ? data.orgId : null,
      contactId: typeof data.contactId === 'string' ? data.contactId : null,
      invoiceId: id,
      amount:
        typeof body.paidAmount === 'number'
          ? body.paidAmount
          : typeof data.total === 'number'
            ? data.total
            : 0,
      currency: typeof data.currency === 'string' ? data.currency : 'ZAR',
    })
  }

  // Send invoice notification if transitioning to sent
  if (body.status === 'sent' && doc.data()?.status === 'draft') {
    notifyInvoiceSent(id).catch(() => {})
  }

  // Log activity event for invoice sent (fire and forget)
  if (body.status === 'sent' && doc.data()?.status === 'draft') {
    const orgId = doc.data()?.orgId
    if (orgId) {
      const actorName = user.uid === 'ai-agent'
        ? 'AI Agent'
        : (await adminDb.collection('users').doc(user.uid).get()).data()?.displayName ?? user.uid

      const invoiceNumber = doc.data()?.invoiceNumber ?? id
      logActivity({
        orgId,
        type: 'invoice_sent',
        actorId: user.uid,
        actorName,
        actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
        description: `Sent invoice #${invoiceNumber}`,
        entityId: id,
        entityType: 'invoice',
        entityTitle: `Invoice #${invoiceNumber}`,
      }).catch(() => {})
    }
  }

  return apiSuccess({ id })
})

export const DELETE = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  await access.ref.delete()
  return apiSuccess({ deleted: true })
})
