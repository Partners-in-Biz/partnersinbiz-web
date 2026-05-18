import { FieldValue } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { generateInvoiceNumber } from '@/lib/invoices/invoice-number'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { logActivity } from '@/lib/activity/log'
import { canAccessOrg, restrictedAdminOrgIds } from '@/lib/api/platformAdmin'

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

export const GET = withAuth('client', async (req, user) => {
  const { searchParams } = new URL(req.url)

  let query: FirebaseFirestore.Query = adminDb.collection('invoices')
  let billingOrgIdFilter: string | null = null
  let orgAccessFilter: string[] | null = null

  if (user.role === 'client') {
    // Clients can only see invoices issued to their own org.
    const userDoc = await adminDb.collection('users').doc(user.uid).get()
    const clientOrgId = userDoc.exists ? (userDoc.data()?.orgId as string | undefined) : undefined
    if (!clientOrgId) return apiSuccess([])
    query = query.where('orgId', '==', clientOrgId)
  } else {
    // Admin / AI can filter freely by orgId / billingOrgId query params.
    const orgId = searchParams.get('orgId')
    const billingOrgId = searchParams.get('billingOrgId')
    if (orgId) {
      if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
      query = query.where('orgId', '==', orgId)
    } else if (user.role === 'admin') {
      const allowedOrgIds = restrictedAdminOrgIds(user)
      if (allowedOrgIds.length > 0) {
        if (allowedOrgIds.length <= 30 && !billingOrgId) {
          query = query.where('orgId', 'in', allowedOrgIds)
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
    .filter((invoice) => !orgAccessFilter || orgAccessFilter.includes(String(invoice.orgId ?? '')))
    .filter((invoice) => !billingOrgIdFilter || invoice.billingOrgId === billingOrgIdFilter)
    .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
    .slice(0, 50)

  return apiSuccess(invoices)
})

export const POST = withAuth('admin', async (req, user) => {
  const body = await req.json().catch(() => ({}))
  if (!body.orgId) return apiError('orgId is required', 400)
  if (!body.lineItems?.length) return apiError('At least one line item is required', 400)
  if (!canAccessOrg(user, body.orgId)) return apiError('Forbidden', 403)

  // Fetch client org for name + billing details snapshot
  const clientOrgDoc = await adminDb.collection('organizations').doc(body.orgId).get()
  if (!clientOrgDoc.exists) return apiError('Client organisation not found', 404)
  const clientOrg = clientOrgDoc.data()!
  const clientBilling = clientOrg.billingDetails ?? {}

  // Fetch platform owner org for "from" details
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

  // Snapshot client details
  const clientDetails = {
    name: clientOrg.name,
    address: clientBilling.address ?? undefined,
    email: clientOrg.billingEmail ?? clientOrg.settings?.notificationEmail ?? undefined,
    phone: clientBilling.phone ?? undefined,
    vatNumber: clientBilling.vatNumber ?? undefined,
  }

  // Generate invoice number: CLI-001 format
  const invoiceNumber = await generateInvoiceNumber(body.orgId, clientOrg.name)

  // Calculate totals
  const lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }> = body.lineItems.map((item: any) => ({
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    amount: Number(item.quantity) * Number(item.unitPrice),
  }))
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)
  const taxRate = Number(body.taxRate ?? 0)
  const taxAmount = subtotal * (taxRate / 100)
  const total = subtotal + taxAmount

  // billingOrgId identifies the platform org doing the billing (defaults to
  // the platform_owner org). Reports split revenue by billingOrgId when a
  // workspace runs multiple billing entities. Override via body.billingOrgId.
  const billingOrgId: string | null =
    typeof body.billingOrgId === 'string' && body.billingOrgId.trim()
      ? body.billingOrgId.trim()
      : platformSnap.empty
        ? null
        : platformSnap.docs[0].id

  const doc = {
    orgId: body.orgId,
    billingOrgId,
    invoiceNumber,
    status: 'draft' as const,
    issueDate: FieldValue.serverTimestamp(),
    dueDate: body.dueDate ? new Date(body.dueDate) : null,
    lineItems,
    subtotal,
    taxRate,
    taxAmount,
    total,
    currency: body.currency ?? clientOrg.settings?.currency ?? 'USD',
    notes: body.notes ?? '',
    fromDetails,
    clientDetails,
    paidAt: null,
    sentAt: null,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const ref = await adminDb.collection('invoices').add(stripUndefined(doc))

  logActivity({
    orgId: body.orgId,
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
    await dispatchWebhook(body.orgId, 'invoice.created', {
      id: ref.id,
      invoiceNumber,
      total,
      currency: doc.currency,
      clientOrgId: body.orgId,
      dueDate: doc.dueDate,
    })
  } catch (err) {
    console.error('[webhook-dispatch-error] invoice.created', err)
  }

  return apiSuccess({ id: ref.id, invoiceNumber }, 201)
})
