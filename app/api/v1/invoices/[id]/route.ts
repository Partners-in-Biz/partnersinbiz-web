import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { notifyInvoiceSent } from '@/lib/notifications/notify'
import { logActivity } from '@/lib/activity/log'
import { requireInvoiceAccess } from '@/lib/invoices/access'
import {
  decorateInvoicePortalCapabilities,
  sanitizeInvoicePortalPatch,
} from '@/lib/billing/portal-permissions'


export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (_req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  return apiSuccess(decorateInvoicePortalCapabilities({ id: access.snap.id, ...access.data }, user))
})

export const PATCH = withAuth('client', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const access = await requireInvoiceAccess(user, id)
  if (!access.ok) return access.response
  const sanitized = sanitizeInvoicePortalPatch(user, access.data, body)
  if (!sanitized.ok) {
    return apiError(sanitized.error, sanitized.status)
  }
  const ref = access.ref
  const doc = access.snap

  // Recalculate totals if line items changed
  let updates: Record<string, unknown> = { ...sanitized.patch, updatedAt: FieldValue.serverTimestamp() }
  if (Array.isArray(sanitized.patch.lineItems)) {
    const lineItems = sanitized.patch.lineItems.map((item) => {
      const source = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      const quantity = Number(source.quantity)
      const unitPrice = Number(source.unitPrice)
      return {
        ...source,
        amount: quantity * unitPrice,
      }
    })
    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)
    const taxRate = Number(sanitized.patch.taxRate ?? doc.data()?.taxRate ?? 0)
    const taxAmount = subtotal * (taxRate / 100)
    updates = { ...updates, lineItems, subtotal, taxRate, taxAmount, total: subtotal + taxAmount }
  }

  if (sanitized.patch.status === 'sent' && doc.data()?.status === 'draft') {
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

  // Best-effort revenue attribution for invoice payment changes remains on the
  // dedicated payment routes. Generic portal PATCH deliberately cannot mark an
  // invoice paid because that bypasses proof/confirmation audit gates.

  // Send invoice notification if transitioning to sent
  if (sanitized.patch.status === 'sent' && doc.data()?.status === 'draft') {
    notifyInvoiceSent(id).catch(() => {})
  }

  // Log activity event for invoice sent (fire and forget)
  if (sanitized.patch.status === 'sent' && doc.data()?.status === 'draft') {
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
