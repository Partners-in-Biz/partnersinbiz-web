// app/api/v1/quotes/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { loadCompany } from '@/lib/companies/store'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  ensurePlatformCompanyForOrg,
  resolvePlatformOwnerOrgId,
} from '@/lib/platform-owner/relationships'
import type { Quote } from '@/lib/quotes/types'
import type { Contact, DealLineItem } from '@/lib/crm/types'
import type { LineItem } from '@/lib/invoices/types'
import { decorateQuotePortalCapabilities, type QuoteAccessKind } from '@/lib/billing/portal-permissions'

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

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function createdAtMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as {
      toMillis?: () => number
      seconds?: number
      _seconds?: number
    }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

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

function accessForQuoteInContext(ctx: CrmAuthContext, quote: Quote): QuoteAccessKind {
  const sourceOrgId = quote.sourceOrgId || quote.orgId
  const recipientOrgId = quote.recipientOrgId || quote.targetOrgId
  if (sourceOrgId && ctxCanAccessOrg(ctx, sourceOrgId)) return 'sender'
  if (recipientOrgId && ctxCanAccessOrg(ctx, recipientOrgId)) return 'recipient'
  if (!quote.sourceOrgId && !quote.recipientOrgId && quote.orgId && ctxCanAccessOrg(ctx, quote.orgId)) return 'legacy'
  return null
}

async function getOrgData(orgId: string): Promise<Record<string, unknown> | null> {
  const doc = await adminDb.collection('organizations').doc(orgId).get()
  return doc.exists ? doc.data() ?? null : null
}

function orgBillingSnapshot(org: Record<string, unknown>) {
  const billing = asRecord(org.billingDetails)
  const settings = asRecord(org.settings)
  const brandProfile = asRecord(org.brandProfile)
  return {
    companyName: cleanString(org.name) || 'Partners in Biz',
    address: billing.address ?? undefined,
    email: org.billingEmail ?? settings.notificationEmail ?? undefined,
    phone: billing.phone ?? undefined,
    vatNumber: billing.vatNumber ?? undefined,
    registrationNumber: billing.registrationNumber ?? undefined,
    website: org.website ?? undefined,
    logoUrl: brandProfile.logoUrl ?? org.logoUrl ?? undefined,
    bankingDetails: billing.bankingDetails ?? undefined,
  }
}

async function loadReceivedQuotesForOrg(orgId: string): Promise<Array<Quote & { id: string }>> {
  const [receivedSnap, targetSnap, legacySnap] = await Promise.all([
    adminDb.collection('quotes').where('recipientOrgId', '==', orgId).get(),
    adminDb.collection('quotes').where('targetOrgId', '==', orgId).get(),
    adminDb.collection('quotes').where('orgId', '==', orgId).get(),
  ])
  const byId = new Map<string, Quote & { id: string }>()
  for (const doc of receivedSnap.docs) byId.set(doc.id, { ...(doc.data() as Quote), id: doc.id })
  for (const doc of targetSnap.docs) byId.set(doc.id, { ...(doc.data() as Quote), id: doc.id })
  for (const doc of legacySnap.docs) {
    const data = doc.data() as Quote
    if (!data.recipientOrgId && !data.targetOrgId && !data.sourceOrgId) {
      byId.set(doc.id, { ...data, id: doc.id })
    }
  }
  return Array.from(byId.values())
}

export const GET = withCrmAuth('viewer', async (req: NextRequest, ctx) => {
  const { searchParams } = new URL(req.url)
  const view = searchParams.get('view') ?? 'sent'
  const requestedOrgId = cleanString(searchParams.get('orgId')) || ctx.orgId
  if (!ctxCanAccessOrg(ctx, requestedOrgId)) return apiError('Forbidden', 403)

  let quotes: Array<Quote & { id: string }>
  if (view === 'received') {
    quotes = await loadReceivedQuotesForOrg(requestedOrgId)
  } else {
    const query: FirebaseFirestore.Query = adminDb.collection('quotes')
      .where('orgId', '==', requestedOrgId)
    const snapshot = await query.get()
    quotes = snapshot.docs.map((doc): Quote & { id: string } => ({ ...(doc.data() as Quote), id: doc.id }))
    if (view === 'shared') quotes = quotes.filter((quote) => Boolean(quote.claimableRelationshipId))
  }

  quotes = quotes
    .filter((quote) => quote.deleted !== true)
    .sort((a, b) => createdAtMillis(b.createdAt ?? b.issueDate) - createdAtMillis(a.createdAt ?? a.issueDate))
    .slice(0, 50)

  return apiSuccess({
    quotes: quotes.map((quote) => decorateQuotePortalCapabilities(quote, accessForQuoteInContext(ctx, quote))),
  })
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
  const platformOrgId = await resolvePlatformOwnerOrgId()
  const requestedRecipientOrgId = cleanString(body.recipientOrgId) ||
    cleanString(body.targetOrgId) ||
    (ctx.user?.role === 'admin' || ctx.isAgent ? cleanString(body.orgId) : '')
  const sourceOrgId = requestedRecipientOrgId ? platformOrgId : ctx.orgId
  const recipientOrgId = requestedRecipientOrgId || undefined

  if (recipientOrgId && !ctxCanAccessOrg(ctx, recipientOrgId)) {
    return apiError('Forbidden for recipient organisation', 403)
  }
  if (!ctxCanAccessOrg(ctx, sourceOrgId)) {
    return apiError('Forbidden for source organisation', 403)
  }

  // A5: optional dealId — pre-fill lineItems from the deal (best-effort)
  let resolvedLineItems = body.lineItems as LineItem[] | undefined
  if (body.dealId && typeof body.dealId === 'string') {
    const dealItems = await prefillFromDeal(body.dealId, sourceOrgId)
    if (dealItems) {
      // Deal items take precedence when body has no lineItems (or empty)
      if (!resolvedLineItems?.length) {
        resolvedLineItems = dealItems
      }
    }
  }

  if (!resolvedLineItems?.length) return apiError('At least one line item is required', 400)

  const sourceOrg = await getOrgData(sourceOrgId)
  if (!sourceOrg) return apiError('Source organisation not found', 404)
  const recipientOrg = recipientOrgId ? await getOrgData(recipientOrgId) : sourceOrg
  if (!recipientOrg) return apiError('Recipient organisation not found', 404)
  const clientOrg = recipientOrg
  const clientBilling = asRecord(clientOrg.billingDetails)
  const clientSettings = asRecord(clientOrg.settings)
  const fromDetails = orgBillingSnapshot(sourceOrg)

  const clientDetails = {
    name: cleanString(clientOrg.name) || recipientOrgId || sourceOrgId,
    address: clientBilling.address ?? undefined,
    email: clientOrg.billingEmail ?? clientSettings.notificationEmail ?? undefined,
    vatNumber: clientBilling.vatNumber ?? undefined,
  }

  // Generate quote number: Q-CLI-001
  // Uses an atomic transaction on a counter document to prevent duplicates under concurrent requests.
  const alphaOnly = cleanString(clientOrg.name).replace(/[^a-zA-Z]/g, '')
  const prefix = (alphaOnly.length >= 3 ? alphaOnly.slice(0, 3) : alphaOnly.padEnd(3, 'X')).toUpperCase()
  const quoteCounterRef = adminDb
    .collection('organizations')
    .doc(sourceOrgId)
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
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)
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
    const loaded = await loadCompany(body.companyId, sourceOrgId)
    if (!loaded) return apiError('Invalid companyId', 400)
    derivedCompanyId = body.companyId
    derivedCompanyName = loaded.data.name
  } else if (contactId) {
    const derived = await deriveCompanyFromContact(contactId, sourceOrgId)
    derivedCompanyId = derived.companyId
    derivedCompanyName = derived.companyName
  }
  if (!derivedCompanyId && recipientOrgId && sourceOrgId === platformOrgId) {
    const platformCompany = await ensurePlatformCompanyForOrg({
      clientOrgId: recipientOrgId,
      clientOrg,
      platformOrgId,
      lifecycleStage: 'customer',
      source: 'platform_resource_create',
      tags: ['client-org'],
    }).catch((err) => {
      console.error('[quote-platform-company-link-error]', err)
      return null
    })
    derivedCompanyId = platformCompany?.companyId
    derivedCompanyName = platformCompany?.companyName
  }

  const quoteData: Record<string, unknown> = {
    orgId: sourceOrgId,
    sourceOrgId,
    issuerOrgId: sourceOrgId,
    recipientOrgId,
    targetOrgId: recipientOrgId,
    claimStatus: recipientOrgId ? 'claimed' : undefined,
    quoteNumber,
    status: 'draft' as const,
    issueDate: FieldValue.serverTimestamp(),
    validUntil: body.validUntil ? new Date(body.validUntil) : null,
    lineItems,
    subtotal,
    taxRate,
    taxAmount,
    total,
    currency: body.currency ?? clientSettings.currency ?? 'ZAR',
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
    sourceCompanyId: derivedCompanyId,
    sourceContactId: contactId,
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
    await dispatchWebhook(sourceOrgId, 'quote.created', {
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
        orgId: sourceOrgId,
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
