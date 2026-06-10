// app/api/v1/quotes/[id]/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { generateInvoiceNumber } from '@/lib/invoices/invoice-number'
import { generateInvoicePdfShareToken } from '@/lib/invoices/share-token'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { notifyQuoteAccepted } from '@/lib/notifications/client-acceptance'
import { loadCompany } from '@/lib/companies/store'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { createFulfillmentForAcceptedQuote } from '@/lib/commerce/quote-fulfillment'
import type { Quote } from '@/lib/quotes/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { Contact } from '@/lib/crm/types'

async function deriveCompanyFromContact(contactId: string, orgId: string): Promise<{ companyId?: string; companyName?: string }> {
  try {
    const snap = await adminDb.collection('contacts').doc(contactId).get()
    if (!snap.exists) return {}
    const c = snap.data() as Contact
    if (c.orgId !== orgId) return {}
    if (!c.companyId) return {}
    return { companyId: c.companyId, companyName: c.companyName }
  } catch (e) {
    console.error('deriveCompanyFromContact failed', e)
    return {}
  }
}

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }
type QuoteAccess = 'sender' | 'recipient' | 'legacy'

// ---------------------------------------------------------------------------
// Tenant-scoped loader — returns 404 for missing OR cross-org OR deleted docs
// ---------------------------------------------------------------------------

function ctxCanAccessOrg(ctx: CrmAuthContext, orgId: string): boolean {
  if (ctx.isAgent) return true
  if (!ctx.user) return orgId === ctx.orgId
  return canAccessOrg({
    uid: ctx.user.uid,
    role: ctx.user.role === 'admin' ? 'admin' : 'client',
    orgId: ctx.user.orgId,
    allowedOrgIds: ctx.user.allowedOrgIds,
  }, orgId)
}

function accessForQuote(data: Quote, ctx: CrmAuthContext): QuoteAccess | null {
  const sourceOrgId = data.sourceOrgId || data.orgId
  const recipientOrgId = data.recipientOrgId || data.targetOrgId
  if (sourceOrgId && ctxCanAccessOrg(ctx, sourceOrgId)) return 'sender'
  if (recipientOrgId && ctxCanAccessOrg(ctx, recipientOrgId)) return 'recipient'
  if (!data.sourceOrgId && !data.recipientOrgId && data.orgId && ctxCanAccessOrg(ctx, data.orgId)) return 'legacy'
  return null
}

async function loadQuote(id: string, ctx: CrmAuthContext) {
  const ref = adminDb.collection('quotes').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false as const, status: 404, error: 'Quote not found' }
  const data = snap.data() as Quote
  if (data.deleted === true) return { ok: false as const, status: 404, error: 'Quote not found' }
  const access = accessForQuote(data, ctx)
  if (!access) return { ok: false as const, status: 404, error: 'Quote not found' }
  return { ok: true as const, ref, data, access }
}

// ---------------------------------------------------------------------------
// GET — viewer+
// ---------------------------------------------------------------------------

export const GET = withCrmAuth<RouteCtx>('viewer', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const r = await loadQuote(id, ctx)
  if (!r.ok) return apiError(r.error, r.status)
  return apiSuccess({ quote: { ...r.data, id } })
})

// ---------------------------------------------------------------------------
// PATCH — member+
// ---------------------------------------------------------------------------

// Allowlist of editable fields beyond the internal meta fields
const EDITABLE_FIELDS = ['status', 'notes', 'validUntil', 'lineItems', 'subtotal', 'taxRate', 'taxAmount', 'total', 'currency', 'fromDetails', 'clientDetails', 'contactId', 'companyId'] as const

async function handleQuoteUpdate(
  req: NextRequest,
  ctx: CrmAuthContext,
  routeCtx: RouteCtx | undefined,
): Promise<Response> {
  const { id } = await routeCtx!.params
  const r = await loadQuote(id, ctx)
  if (!r.ok) return apiError(r.error, r.status)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return apiError('Invalid JSON body', 400)
  }

  const actorRef: MemberRef = ctx.actor
  const before = r.data
  const sourceOrgId = before.sourceOrgId || before.orgId
  const recipientOrgId = before.recipientOrgId || before.targetOrgId
  const recipientOnly = r.access === 'recipient'

  if (recipientOnly) {
    const requestedStatus = typeof body.status === 'string' ? body.status : ''
    const onlyStatus = Object.keys(body).every((key) => key === 'status')
    if (!onlyStatus || !['accepted', 'declined', 'rejected'].includes(requestedStatus)) {
      return apiError('Recipients can only accept or decline received quotes', 403)
    }
  }

  // -------------------------------------------------------------------------
  // SPECIAL PATH: convert-to-invoice
  // -------------------------------------------------------------------------
  if (body.action === 'convert-to-invoice') {
    if (r.access !== 'sender' && r.access !== 'legacy') {
      return apiError('Only the sender can convert this quote to an invoice', 403)
    }
    if (before.status !== 'accepted') {
      return apiError('Only accepted quotes can be converted to invoices', 400)
    }
    if (before.convertedInvoiceId) {
      return apiError('Quote has already been converted', 400)
    }

    // Fetch client org name for invoice number generation
    const clientOrgDoc = await adminDb.collection('organizations').doc(recipientOrgId || sourceOrgId).get()
    const clientName = clientOrgDoc.exists ? clientOrgDoc.data()!.name : 'Unknown'

    let invoiceNumber: string
    try {
      invoiceNumber = await generateInvoiceNumber(sourceOrgId, clientName)
    } catch (err) {
      console.error('[invoice-number-error] generateInvoiceNumber', err)
      return apiError('Failed to generate invoice number', 500)
    }

    // Create invoice from quote data
    const invoiceDoc: Record<string, unknown> = {
      orgId: sourceOrgId,
      sourceOrgId,
      issuerOrgId: before.issuerOrgId || sourceOrgId,
      billingOrgId: before.orgId,
      recipientOrgId,
      targetOrgId: recipientOrgId,
      recipientUserId: before.recipientUserId,
      targetUserId: before.targetUserId,
      sourceCompanyId: before.sourceCompanyId || before.companyId,
      sourceContactId: before.sourceContactId || before.contactId,
      companyId: before.companyId,
      contactId: before.contactId,
      recipientEmail: before.recipientEmail,
      recipientName: before.recipientName,
      recipientCompanyName: before.recipientCompanyName,
      claimableRelationshipId: before.claimableRelationshipId,
      claimToken: before.claimToken,
      claimStatus: before.claimStatus,
      invoiceNumber,
      pdfShareToken: generateInvoicePdfShareToken(),
      status: 'draft' as const,
      issueDate: FieldValue.serverTimestamp(),
      dueDate: null,
      lineItems: before.lineItems,
      subtotal: before.subtotal,
      taxRate: before.taxRate,
      taxAmount: before.taxAmount,
      total: before.total,
      currency: before.currency,
      notes: before.notes,
      fromDetails: before.fromDetails,
      clientDetails: before.clientDetails,
      paidAt: null,
      sentAt: null,
      createdByRef: actorRef,
      updatedByRef: actorRef,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    // Omit createdBy / updatedBy uid for agent calls (PR 3 pattern)
    if (!ctx.isAgent) {
      invoiceDoc.createdBy = actorRef.uid
      invoiceDoc.updatedBy = actorRef.uid
    }

    const invoiceRef = await adminDb.collection('invoices').add(
      Object.fromEntries(Object.entries(invoiceDoc).filter(([, v]) => v !== undefined)),
    )

    // Mark quote as converted
    await r.ref.update({
      status: 'converted',
      convertedInvoiceId: invoiceRef.id,
      updatedByRef: actorRef,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return apiSuccess({ invoiceId: invoiceRef.id, invoiceNumber })
  }

  // -------------------------------------------------------------------------
  // REGULAR PATH: status update + other field updates
  // -------------------------------------------------------------------------

  // Empty-body guard: at least one editable field must be present
  const hasEditable = EDITABLE_FIELDS.some((f) => body[f] !== undefined)
  if (!hasEditable) return apiError('No editable fields supplied', 400)

  const patch: Record<string, unknown> = {
    updatedByRef: actorRef,
    updatedAt: FieldValue.serverTimestamp(),
  }

  // Only set updatedBy uid for human (non-agent) callers
  if (!ctx.isAgent) {
    patch.updatedBy = actorRef.uid
  }

  // Apply allowlisted editable fields from body
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) {
      patch[field] = body[field]
    }
  }

  // Company association handling
  // Explicit clear: { companyId: '' } → remove both fields via FieldValue.delete()
  if (typeof body.companyId === 'string' && body.companyId === '') {
    patch.companyId = FieldValue.delete()
    patch.companyName = FieldValue.delete()
  } else if (typeof body.companyId === 'string' && body.companyId) {
    // Explicit set: validate and stamp companyName
    const loaded = await loadCompany(body.companyId, sourceOrgId)
    if (!loaded) return apiError('Invalid companyId', 400)
    patch.companyId = body.companyId
    patch.sourceCompanyId = body.companyId
    patch.companyName = loaded.data.name
  } else if (typeof body.contactId === 'string' && body.contactId && body.contactId !== before.contactId) {
    // contactId changed: re-derive company from new contact
    patch.sourceContactId = body.contactId
    const derived = await deriveCompanyFromContact(body.contactId, sourceOrgId)
    if (derived.companyId) {
      patch.companyId = derived.companyId
      patch.sourceCompanyId = derived.companyId
      patch.companyName = derived.companyName
    }
  }

  const fromStatus = before.status
  const toStatus = typeof body.status === 'string' ? body.status : undefined
  const statusChanged = toStatus !== undefined && toStatus !== fromStatus

  // Side effects on status transitions
  if (statusChanged) {
    if (fromStatus === 'draft' && toStatus === 'sent') {
      patch.sentAt = FieldValue.serverTimestamp()
    }
    if (toStatus === 'accepted') {
      patch.acceptedAt = FieldValue.serverTimestamp()
    }
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  await r.ref.update(sanitized)

  // Dispatch status-change webhooks (explicit-field payload, PR 3+ pattern — no body spread)
  let fulfillment: Awaited<ReturnType<typeof createFulfillmentForAcceptedQuote>> | undefined
  if (statusChanged) {
    if (toStatus === 'accepted') {
      try {
        fulfillment = await createFulfillmentForAcceptedQuote({
          quoteId: id,
          quote: { ...before, ...sanitized, status: 'accepted', id },
          actor: actorRef,
        })
      } catch (err) {
        console.error('[quote-fulfillment-error] quote.accepted', err)
      }
      try {
        await dispatchWebhook(sourceOrgId, 'quote.accepted', {
          id,
          quoteNumber: before.quoteNumber,
          total: before.total,
          currency: before.currency,
          companyId: before.companyId,
          companyName: before.companyName,
          recipientOrgId,
          updatedByRef: actorRef,
        })
      } catch (err) {
        console.error('[webhook-dispatch-error] quote.accepted', err)
      }
      try {
        await notifyQuoteAccepted({
          orgId: sourceOrgId,
          quoteId: id,
          quoteNumber: before.quoteNumber,
          total: before.total,
          currency: before.currency,
          companyName: before.companyName,
        })
      } catch (err) {
        console.error('[notification-dispatch-error] quote.accepted', err)
      }
    } else if (toStatus === 'rejected' || toStatus === 'declined') {
      try {
        await dispatchWebhook(sourceOrgId, 'quote.rejected', {
          id,
          quoteNumber: before.quoteNumber,
          total: before.total,
          currency: before.currency,
          companyId: before.companyId,
          companyName: before.companyName,
          recipientOrgId,
          updatedByRef: actorRef,
        })
      } catch (err) {
        console.error('[webhook-dispatch-error] quote.rejected', err)
      }
    }

    // Best-effort contact timeline writes for status transitions
    const contactId = typeof before.contactId === 'string' && before.contactId ? before.contactId : undefined
    if (contactId) {
      let activityType: string | undefined
      let activitySummary: string | undefined

      if (fromStatus === 'draft' && toStatus === 'sent') {
        activityType = 'email'
        activitySummary = `Quote sent: ${before.quoteNumber}`
      } else if (toStatus === 'accepted') {
        activityType = 'note'
        activitySummary = `Quote accepted: ${before.quoteNumber}`
      } else if (toStatus === 'rejected' || toStatus === 'declined') {
        activityType = 'note'
        activitySummary = `Quote rejected: ${before.quoteNumber}`
      }

      if (activityType && activitySummary) {
        try {
          const activityData = Object.fromEntries(Object.entries({
            orgId: sourceOrgId,
            contactId,
            type: activityType,
            summary: activitySummary,
            metadata: { quoteNumber: before.quoteNumber, fromStatus, toStatus },
            createdBy: ctx.isAgent ? undefined : actorRef.uid,
            createdByRef: actorRef,
            createdAt: FieldValue.serverTimestamp(),
          }).filter(([, v]) => v !== undefined))
          await adminDb.collection('activities').add(activityData)
        } catch (err) {
          console.error('[activities] timeline write failed (quote status change)', err)
        }
      }
    }
  }

  return apiSuccess({ quote: { ...before, ...sanitized, id }, fulfillment })
}

export const PATCH = withCrmAuth<RouteCtx>('member', handleQuoteUpdate)

// ---------------------------------------------------------------------------
// DELETE — admin+ (hard delete, matching baseline behaviour)
// ---------------------------------------------------------------------------

export const DELETE = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const r = await loadQuote(id, ctx)
  if (!r.ok) return apiError(r.error, r.status)
  if (r.access === 'recipient') return apiError('Only the sender can delete this quote', 403)
  await r.ref.delete()
  return apiSuccess({ id })
})
