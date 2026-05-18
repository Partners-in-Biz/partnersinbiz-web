// app/api/v1/quotes/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { loadCompany } from '@/lib/companies/store'
import type { Quote } from '@/lib/quotes/types'
import type { Contact, DealLineItem } from '@/lib/crm/types'
import type { LineItem } from '@/lib/invoices/types'

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

export const GET = withCrmAuth('viewer', async (_req: NextRequest, ctx) => {
  const snapshot = await adminDb
    .collection('quotes')
    .where('orgId', '==', ctx.orgId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()

  const quotes = snapshot.docs.map((doc: any) => ({ ...(doc.data() as Quote), id: doc.id }))
  return apiSuccess({ quotes })
})

/** Map DealLineItem[] → quote LineItem[] */
function mapDealLineItems(dealItems: DealLineItem[]): LineItem[] {
  return dealItems.map((item) => ({
    description: item.name,
    quantity: item.qty,
    unitPrice: item.unitPrice,
    amount: item.total,
  }))
}

/** Best-effort: fetch deal and return pre-filled line items. Returns null on any failure. */
async function prefillFromDeal(dealId: string, orgId: string): Promise<LineItem[] | null> {
  try {
    const dealSnap = await adminDb.collection('deals').doc(dealId).get()
    if (!dealSnap.exists) return null
    const deal = dealSnap.data()!
    if (deal.orgId !== orgId) {
      console.warn('[quote-prefill] cross-tenant dealId rejected', dealId)
      return null
    }
    if (!deal.lineItems?.length) return null
    return mapDealLineItems(deal.lineItems as DealLineItem[])
  } catch (e) {
    console.error('[quote-prefill] deal lookup failed', e)
    return null
  }
}

export const POST = withCrmAuth('member', async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({}))

  // A5: optional dealId — pre-fill lineItems from the deal (best-effort)
  let resolvedLineItems = body.lineItems as LineItem[] | undefined
  if (body.dealId && typeof body.dealId === 'string') {
    const dealItems = await prefillFromDeal(body.dealId, ctx.orgId)
    if (dealItems) {
      // Deal items take precedence when body has no lineItems (or empty)
      if (!resolvedLineItems?.length) {
        resolvedLineItems = dealItems
      }
    }
  }

  if (!resolvedLineItems?.length) return apiError('At least one line item is required', 400)

  // Fetch client org for prefix + billing + currency
  const clientOrgDoc = await adminDb.collection('organizations').doc(ctx.orgId).get()
  if (!clientOrgDoc.exists) return apiError('Client organisation not found', 404)
  const clientOrg = clientOrgDoc.data()!
  const clientBilling = clientOrg.billingDetails ?? {}

  // Fetch platform owner for "from" details
  const platformSnap = await adminDb
    .collection('organizations')
    .where('type', '==', 'platform_owner')
    .limit(1)
    .get()

  let fromDetails: Record<string, any> = { companyName: 'Partners in Biz' }
  if (!platformSnap.empty) {
    const platform = platformSnap.docs[0].data()
    const pb = platform.billingDetails ?? {}
    fromDetails = {
      companyName: platform.name,
      address: pb.address ?? undefined,
      email: platform.billingEmail ?? platform.settings?.notificationEmail ?? undefined,
      phone: pb.phone ?? undefined,
      vatNumber: pb.vatNumber ?? undefined,
      registrationNumber: pb.registrationNumber ?? undefined,
      website: platform.website ?? undefined,
      logoUrl: platform.brandProfile?.logoUrl ?? platform.logoUrl ?? undefined,
      bankingDetails: pb.bankingDetails ?? undefined,
    }
  }

  const clientDetails = {
    name: clientOrg.name,
    address: clientBilling.address ?? undefined,
    email: clientOrg.billingEmail ?? clientOrg.settings?.notificationEmail ?? undefined,
    vatNumber: clientBilling.vatNumber ?? undefined,
  }

  // Generate quote number: Q-CLI-001
  // Uses an atomic transaction on a counter document to prevent duplicates under concurrent requests.
  const alphaOnly = clientOrg.name.replace(/[^a-zA-Z]/g, '')
  const prefix = (alphaOnly.length >= 3 ? alphaOnly.slice(0, 3) : alphaOnly.padEnd(3, 'X')).toUpperCase()
  const quoteCounterRef = adminDb
    .collection('organizations')
    .doc(ctx.orgId)
    .collection('counters')
    .doc('quotes')
  let quoteCount = 1
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(quoteCounterRef)
    const next = snap.exists ? (snap.data()!.count as number) + 1 : 1
    tx.set(quoteCounterRef, { count: next }, { merge: true })
    quoteCount = next
  })
  const quoteNumber = `Q-${prefix}-${String(quoteCount).padStart(3, '0')}`

  // Calculate totals
  const lineItems = (resolvedLineItems as LineItem[]).map((item) => ({
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    amount: Number(item.quantity) * Number(item.unitPrice),
  }))
  const subtotal = lineItems.reduce((sum: number, item: any) => sum + item.amount, 0)
  const taxRate = Number(body.taxRate ?? 0)
  const taxAmount = subtotal * (taxRate / 100)
  const total = subtotal + taxAmount

  const actorRef = ctx.actor

  // Optional CRM contact link
  const contactId = typeof body.contactId === 'string' && body.contactId ? body.contactId : undefined

  // Company association: explicit companyId wins; otherwise auto-derive from contact
  let derivedCompanyId: string | undefined
  let derivedCompanyName: string | undefined
  if (body.companyId && typeof body.companyId === 'string') {
    const loaded = await loadCompany(body.companyId, ctx.orgId)
    if (!loaded) return apiError('Invalid companyId', 400)
    derivedCompanyId = body.companyId
    derivedCompanyName = loaded.data.name
  } else if (contactId) {
    const derived = await deriveCompanyFromContact(contactId, ctx.orgId)
    derivedCompanyId = derived.companyId
    derivedCompanyName = derived.companyName
  }

  const quoteData: Record<string, unknown> = {
    orgId: ctx.orgId,
    quoteNumber,
    status: 'draft' as const,
    issueDate: FieldValue.serverTimestamp(),
    validUntil: body.validUntil ? new Date(body.validUntil) : null,
    lineItems,
    subtotal,
    taxRate,
    taxAmount,
    total,
    currency: body.currency ?? clientOrg.settings?.currency ?? 'ZAR',
    notes: body.notes ?? '',
    fromDetails,
    clientDetails,
    convertedInvoiceId: null,
    sentAt: null,
    acceptedAt: null,
    createdByRef: actorRef,
    updatedByRef: actorRef,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    contactId,
    companyId: derivedCompanyId,
    companyName: derivedCompanyName,
  }

  // Omit createdBy / updatedBy uid for agent calls
  if (!ctx.isAgent) {
    quoteData.createdBy = actorRef.uid
    quoteData.updatedBy = actorRef.uid
  }

  // Strip undefined values so Firestore doesn't reject
  const sanitized = Object.fromEntries(Object.entries(quoteData).filter(([, v]) => v !== undefined))

  const docRef = adminDb.collection('quotes').doc()
  await docRef.set(sanitized)

  // Explicit-field webhook payload (PR 3+ pattern — no body spread)
  try {
    await dispatchWebhook(ctx.orgId, 'quote.created', {
      id: docRef.id,
      quoteNumber,
      status: 'draft',
      total,
      currency: sanitized.currency as string,
      validUntil: sanitized.validUntil ?? null,
      companyId: sanitized.companyId as string | undefined,
      companyName: sanitized.companyName as string | undefined,
      createdByRef: actorRef,
    })
  } catch (err) {
    console.error('[webhook-dispatch-error] quote.created', err)
  }

  // Best-effort contact timeline write
  if (contactId) {
    try {
      const activityData = Object.fromEntries(Object.entries({
        orgId: ctx.orgId,
        contactId,
        type: 'note',
        summary: `Quote created: ${quoteNumber} (${sanitized.currency} ${total})`,
        metadata: { quoteNumber, total, currency: sanitized.currency, quoteId: docRef.id },
        createdBy: ctx.isAgent ? undefined : actorRef.uid,
        createdByRef: actorRef,
        createdAt: FieldValue.serverTimestamp(),
      }).filter(([, v]) => v !== undefined))
      await adminDb.collection('activities').add(activityData)
    } catch (err) {
      console.error('[activities] timeline write failed (quote.created)', err)
    }
  }

  return apiSuccess({ ...sanitized, id: docRef.id }, 201)
})
