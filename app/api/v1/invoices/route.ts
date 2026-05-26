import { FieldValue } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { generateInvoiceNumber } from '@/lib/invoices/invoice-number'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { logActivity } from '@/lib/activity/log'
import { canAccessOrg, restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import { ensureClaimableRelationship } from '@/lib/claimable-relationships/store'
import { canManageOrgAs } from '@/lib/orgMembers/permissions'
import { resolvePlatformOwnerOrgId } from '@/lib/platform-owner/relationships'

export const dynamic = 'force-dynamic'

type InvoiceListItem = {
  id: string
  createdAt?: unknown
  billingOrgId?: string | null
  [key: string]: unknown
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  return Object.getPrototypeOf(value) === Object.prototype
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {}
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T
  }

  if (!isPlainRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
  ) as T
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeEmail(value: unknown): string {
  return cleanString(value).toLowerCase()
}

function invoiceLooksLikeLegacyPlatformBill(invoice: InvoiceListItem, recipientOrgId: string, platformOrgId: string): boolean {
  if (invoice.recipientOrgId || invoice.targetOrgId) return false
  if (invoice.orgId !== recipientOrgId) return false
  if (invoice.billingOrgId === platformOrgId) return true
  const fromDetails = asRecord(invoice.fromDetails)
  return cleanString(fromDetails.companyName).toLowerCase().includes('partners in biz')
}

async function loadReceivedInvoicesForOrg(orgId: string): Promise<InvoiceListItem[]> {
  const platformOrgId = await resolvePlatformOwnerOrgId()
  const [receivedSnap, targetSnap, legacySnap] = await Promise.all([
    adminDb.collection('invoices').where('recipientOrgId', '==', orgId).get(),
    adminDb.collection('invoices').where('targetOrgId', '==', orgId).get(),
    adminDb.collection('invoices').where('orgId', '==', orgId).get(),
  ])
  const byId = new Map<string, InvoiceListItem>()
  for (const doc of receivedSnap.docs) byId.set(doc.id, { id: doc.id, ...doc.data() })
  for (const doc of targetSnap.docs) byId.set(doc.id, { id: doc.id, ...doc.data() })
  for (const doc of legacySnap.docs) {
    const invoice = { id: doc.id, ...doc.data() } as InvoiceListItem
    if (invoiceLooksLikeLegacyPlatformBill(invoice, orgId, platformOrgId)) {
      byId.set(doc.id, invoice)
    }
  }
  return Array.from(byId.values())
}

function hasClaimableTarget(body: Record<string, unknown>): boolean {
  return Boolean(
    cleanString(body.companyId) ||
    cleanString(body.contactId) ||
    cleanString(body.recipientEmail) ||
    cleanString(body.recipientOrgId),
  )
}

async function loadOwnedCrmRecord(
  collectionName: 'companies' | 'contacts',
  id: string,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  if (!id) return null
  const snap = await adminDb.collection(collectionName).doc(id).get()
  if (!snap.exists) return null
  const data = (snap.data() ?? {}) as Record<string, unknown>
  return data.orgId === orgId ? data : null
}

async function resolveInvoiceCrmTarget(body: Record<string, unknown>, sourceOrgId: string) {
  const companyId = cleanString(body.companyId)
  const contactId = cleanString(body.contactId)
  const clientDetailsInput = asRecord(body.clientDetails)
  const [company, contact] = await Promise.all([
    loadOwnedCrmRecord('companies', companyId, sourceOrgId),
    loadOwnedCrmRecord('contacts', contactId, sourceOrgId),
  ])

  const recipientEmail = normalizeEmail(
    body.recipientEmail ??
    clientDetailsInput.email ??
    contact?.email ??
    company?.email,
  )
  const recipientName = cleanString(body.recipientName) ||
    cleanString(clientDetailsInput.name) ||
    cleanString(contact?.name) ||
    recipientEmail
  const recipientCompanyName = cleanString(body.recipientCompanyName) ||
    cleanString(company?.name) ||
    cleanString(contact?.companyName) ||
    cleanString(contact?.company) ||
    recipientName
  const recipientOrgId = cleanString(body.recipientOrgId) || cleanString(company?.linkedOrgId)
  const recipientUserId = cleanString(body.recipientUserId) || cleanString(contact?.linkedUserId)

  return {
    companyId,
    contactId,
    company,
    contact,
    recipientEmail,
    recipientName,
    recipientCompanyName,
    recipientOrgId,
    recipientUserId,
  }
}

function orgBillingSnapshot(org: Record<string, unknown>) {
  const billing = asRecord(org.billingDetails)
  const settings = asRecord(org.settings)
  const brandProfile = asRecord(org.brandProfile)
  return {
    companyName: org.name,
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

export const GET = withAuth('client', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const view = searchParams.get('view') ?? 'sent'
  const sharedOnly = view === 'shared'
  const orgField = view === 'received' ? 'recipientOrgId' : 'orgId'

  let query: FirebaseFirestore.Query = adminDb.collection('invoices')
  let billingOrgIdFilter: string | null = null
  let orgAccessFilter: string[] | null = null

  if (user.role === 'client') {
    const requestedOrgId = searchParams.get('orgId') ?? user.orgId ?? user.orgIds?.[0]
    if (!requestedOrgId || !canAccessOrg(user, requestedOrgId)) return apiSuccess([])
    if (view === 'received') {
      const invoices = (await loadReceivedInvoicesForOrg(requestedOrgId))
        .filter((invoice) => !sharedOnly || Boolean(invoice.claimableRelationshipId))
        .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
        .slice(0, 50)
      return apiSuccess(invoices)
    }
    query = query.where(orgField, '==', requestedOrgId)
  } else {
    // Admin / AI can filter freely by orgId / billingOrgId query params.
    const orgId = searchParams.get('orgId')
    const billingOrgId = searchParams.get('billingOrgId')
    if (orgId) {
      if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
      query = query.where(orgField, '==', orgId)
    } else if (user.role === 'admin') {
      const allowedOrgIds = restrictedAdminOrgIds(user)
      if (allowedOrgIds.length > 0) {
        if (allowedOrgIds.length <= 30 && !billingOrgId) {
          query = query.where(orgField, 'in', allowedOrgIds)
        } else {
          orgAccessFilter = allowedOrgIds
        }
      }
    }
    if (billingOrgId) {
      if (orgId) {
        billingOrgIdFilter = billingOrgId
      } else {
        query = query.where('billingOrgId', '==', billingOrgId)
      }
    }
  }

  const snapshot = await query.get()
  const invoices = snapshot.docs
    .map((doc): InvoiceListItem => ({ id: doc.id, ...doc.data() }))
    .filter((invoice) => !orgAccessFilter || orgAccessFilter.includes(String(invoice[orgField] ?? '')))
    .filter((invoice) => !billingOrgIdFilter || invoice.billingOrgId === billingOrgIdFilter)
    .filter((invoice) => !sharedOnly || Boolean(invoice.claimableRelationshipId))
    .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
    .slice(0, 50)

  return apiSuccess(invoices)
})

export const POST = withAuth('client', async (req, user) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const requestedOrgId = cleanString(body.orgId)
  const rawLineItems = Array.isArray(body.lineItems) ? body.lineItems : []
  if (!requestedOrgId) return apiError('orgId is required', 400)
  if (rawLineItems.length === 0) return apiError('At least one line item is required', 400)
  const claimableInvoice = hasClaimableTarget(body)
  const platformOwnerOrgId = await resolvePlatformOwnerOrgId()
  const platformIssuedInvoice = !claimableInvoice && (user.role === 'admin' || user.role === 'ai')
  const sourceOrgId = platformIssuedInvoice ? platformOwnerOrgId : requestedOrgId
  const recipientOrgId = platformIssuedInvoice ? requestedOrgId : cleanString(body.recipientOrgId)
  if (!(await canManageOrgAs(user, platformIssuedInvoice ? recipientOrgId : sourceOrgId))) {
    return apiError('Forbidden', 403)
  }

  // Fetch sender + client org snapshots.
  const sourceOrgDoc = await adminDb.collection('organizations').doc(sourceOrgId).get()
  if (!sourceOrgDoc.exists) return apiError('Source organisation not found', 404)
  const sourceOrg = (sourceOrgDoc.data() ?? {}) as Record<string, unknown>
  const targetClientOrgId = recipientOrgId || sourceOrgId
  const clientOrgDoc = await adminDb.collection('organizations').doc(targetClientOrgId).get()
  if (!clientOrgDoc.exists) return apiError('Client organisation not found', 404)
  const clientOrg = (clientOrgDoc.data() ?? {}) as Record<string, unknown>
  const clientBilling = asRecord(clientOrg.billingDetails)
  const crmTarget = claimableInvoice ? await resolveInvoiceCrmTarget(body, sourceOrgId) : null
  if (claimableInvoice && crmTarget?.companyId && !crmTarget.company) {
    return apiError('CRM company not found', 404)
  }
  if (claimableInvoice && crmTarget?.contactId && !crmTarget.contact) {
    return apiError('CRM contact not found', 404)
  }
  if (claimableInvoice && !crmTarget?.recipientEmail) {
    return apiError('recipientEmail is required for CRM invoices', 400)
  }

  const fromDetails: Record<string, unknown> = orgBillingSnapshot(sourceOrg)

  // Snapshot client details
  const clientDetails = claimableInvoice && crmTarget
    ? {
        name: crmTarget.recipientCompanyName,
        contactName: crmTarget.recipientName,
        email: crmTarget.recipientEmail,
        phone: crmTarget.contact?.phone ?? crmTarget.company?.phone ?? undefined,
        vatNumber: crmTarget.company?.vatNumber ?? undefined,
      }
    : {
        name: clientOrg.name,
        address: clientBilling.address ?? undefined,
        email: clientOrg.billingEmail ?? asRecord(clientOrg.settings).notificationEmail ?? undefined,
        phone: clientBilling.phone ?? undefined,
        vatNumber: clientBilling.vatNumber ?? undefined,
      }

  // Generate invoice number: CLI-001 format
  const invoiceNumber = await generateInvoiceNumber(sourceOrgId, cleanString(clientOrg.name) || sourceOrgId)

  // Calculate totals
  const lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }> = rawLineItems.map((item) => {
    const source = asRecord(item)
    const quantity = Number(source.quantity)
    const unitPrice = Number(source.unitPrice)
    return {
      description: cleanString(source.description),
      quantity,
      unitPrice,
      amount: quantity * unitPrice,
    }
  })
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)
  const taxRate = Number(body.taxRate ?? 0)
  const taxAmount = subtotal * (taxRate / 100)
  const total = subtotal + taxAmount

  // billingOrgId identifies the platform org doing the billing (defaults to
  // the platform_owner org). Reports split revenue by billingOrgId when a
  // workspace runs multiple billing entities. Override via body.billingOrgId.
  const billingOrgId: string | null =
    cleanString(body.billingOrgId)
      ? cleanString(body.billingOrgId)
      : claimableInvoice
        ? sourceOrgId
        : platformOwnerOrgId

  const doc = {
    orgId: sourceOrgId,
    sourceOrgId,
    issuerOrgId: sourceOrgId,
    billingOrgId,
    invoiceNumber,
    status: 'draft' as const,
    issueDate: FieldValue.serverTimestamp(),
    dueDate: cleanString(body.dueDate) ? new Date(cleanString(body.dueDate)) : null,
    lineItems,
    subtotal,
    taxRate,
    taxAmount,
    total,
    currency: cleanString(body.currency) || cleanString(asRecord(clientOrg.settings).currency) || 'USD',
    notes: cleanString(body.notes),
    fromDetails,
    clientDetails,
    paidAt: null,
    sentAt: null,
    sourceCompanyId: crmTarget?.companyId || undefined,
    sourceContactId: crmTarget?.contactId || undefined,
    companyId: crmTarget?.companyId || undefined,
    contactId: crmTarget?.contactId || undefined,
    recipientEmail: crmTarget?.recipientEmail || undefined,
    recipientName: crmTarget?.recipientName || undefined,
    recipientCompanyName: crmTarget?.recipientCompanyName || undefined,
    recipientOrgId: crmTarget?.recipientOrgId || recipientOrgId || undefined,
    recipientUserId: crmTarget?.recipientUserId || undefined,
    targetOrgId: crmTarget?.recipientOrgId || recipientOrgId || undefined,
    targetUserId: crmTarget?.recipientUserId || undefined,
    claimStatus: claimableInvoice
      ? (crmTarget?.recipientOrgId ? 'claimed' : 'pending')
      : recipientOrgId ? 'claimed' : undefined,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const ref = await adminDb.collection('invoices').add(stripUndefined(doc))
  let claimToken: string | undefined
  let claimStatus: string | undefined

  if (claimableInvoice && crmTarget) {
    const relationship = await ensureClaimableRelationship({
      sourceOrgId,
      sourceCompanyId: crmTarget.companyId || undefined,
      sourceContactId: crmTarget.contactId || undefined,
      recipientOrgId: crmTarget.recipientOrgId || undefined,
      recipientUserId: crmTarget.recipientUserId || undefined,
      recipientEmail: crmTarget.recipientEmail,
      recipientName: crmTarget.recipientName,
      recipientCompanyName: crmTarget.recipientCompanyName,
      resourceType: 'invoice',
      resourceId: ref.id,
    })

    claimToken = relationship.claimToken
    claimStatus = relationship.targetOrgId || relationship.status === 'claimed' ? 'claimed' : 'pending'
    await adminDb.collection('invoices').doc(ref.id).update(stripUndefined({
      claimableRelationshipId: relationship.id,
      claimToken: relationship.claimToken,
      claimStatus,
      recipientOrgId: relationship.targetOrgId,
      recipientUserId: relationship.targetUserId,
      targetOrgId: relationship.targetOrgId,
      targetUserId: relationship.targetUserId,
      updatedAt: FieldValue.serverTimestamp(),
    }))
  }

  logActivity({
    orgId: sourceOrgId,
    type: 'invoice_created',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Created invoice',
    entityId: ref.id,
    entityType: 'invoice',
    entityTitle: invoiceNumber,
  }).catch(() => {})

  try {
    await dispatchWebhook(sourceOrgId, 'invoice.created', {
      id: ref.id,
      invoiceNumber,
      total,
      currency: doc.currency,
      clientOrgId: recipientOrgId || crmTarget?.recipientOrgId || sourceOrgId,
      recipientOrgId: recipientOrgId || crmTarget?.recipientOrgId || null,
      dueDate: doc.dueDate,
    })
  } catch (err) {
    console.error('[webhook-dispatch-error] invoice.created', err)
  }

  return apiSuccess(stripUndefined({ id: ref.id, invoiceNumber, claimToken, claimStatus }), 201)
})
