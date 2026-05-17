/**
 * GET  /api/v1/crm/contacts  — list contacts (filterable, paginated)
 * POST /api/v1/crm/contacts  — create a new contact
 *
 * Query params (GET): stage, type, source, search, limit (default 50), page (default 1)
 * Auth: GET → viewer+, POST → member+
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { resolveMemberRef } from '@/lib/orgMembers/memberRef'
import { apiSuccess, apiError } from '@/lib/api/response'
import type {
  Contact,
  ContactInput,
  ContactStage,
  ContactType,
  ContactSource,
} from '@/lib/crm/types'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { logActivity } from '@/lib/activity/log'
import { loadCompany } from '@/lib/companies/store'

const VALID_STAGES: ContactStage[] = [
  'new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost',
]
const VALID_TYPES: ContactType[] = ['lead', 'prospect', 'client', 'churned']
const VALID_SOURCES: ContactSource[] = ['manual', 'form', 'import', 'outreach']

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const { orgId } = ctx

  const stage = searchParams.get('stage') as ContactStage | null
  const type = searchParams.get('type') as ContactType | null
  const source = searchParams.get('source') as ContactSource | null
  const tagsParam = searchParams.get('tags') ?? ''
  const capturedFromId = searchParams.get('capturedFromId') ?? ''
  const search = searchParams.get('search') ?? ''
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const page = Math.max(parseInt(searchParams.get('page') ?? '1'), 1)

  const tagList = tagsParam
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tagList.length > 10) {
    return apiError('tags filter supports up to 10 values (array-contains-any limit)', 400)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('contacts').orderBy('createdAt', 'desc')

  if (orgId) {
    query = query.where('orgId', '==', orgId)
  }
  if (capturedFromId) {
    query = query.where('capturedFromId', '==', capturedFromId)
  }
  if (stage && VALID_STAGES.includes(stage)) {
    query = query.where('stage', '==', stage)
  }
  if (type && VALID_TYPES.includes(type)) {
    query = query.where('type', '==', type)
  }
  if (source && VALID_SOURCES.includes(source)) {
    query = query.where('source', '==', source)
  }
  if (tagList.length > 0) {
    query = query.where('tags', 'array-contains-any', tagList)
  }

  const snapshot = await query
    .limit(limit)
    .offset((page - 1) * limit)
    .get()

  let contacts: Contact[] = snapshot.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((c: Contact) => c.deleted !== true)

  if (search) {
    const q = search.toLowerCase()
    contacts = contacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q),
    )
  }

  return apiSuccess(contacts, 200, { total: contacts.length, page, limit })
})

export const POST = withCrmAuth('member', async (req, ctx) => {
  const body = await req.json() as ContactInput

  if (!body.name?.trim()) return apiError('Name is required')
  if (!body.email?.trim()) return apiError('Email is required')
  if (!isValidEmail(body.email)) return apiError('Email is invalid')
  if (body.stage && !VALID_STAGES.includes(body.stage)) return apiError('Invalid stage')
  if (body.type && !VALID_TYPES.includes(body.type)) return apiError('Invalid type')
  if (body.source && !VALID_SOURCES.includes(body.source)) return apiError('Invalid source')

  const { orgId } = ctx

  const capturedFromId = typeof (body as { capturedFromId?: unknown }).capturedFromId === 'string'
    ? ((body as { capturedFromId?: string }).capturedFromId as string).trim()
    : ''

  const actorRef = ctx.actor

  // Resolve assignedToRef when assignedTo is provided (mirrors PATCH handler logic)
  let assignedToRef: import('@/lib/orgMembers/memberRef').MemberRef | undefined
  if (typeof body.assignedTo === 'string' && body.assignedTo !== '') {
    assignedToRef = await resolveMemberRef(ctx.orgId, body.assignedTo)
  }

  // Resolve companyId → companyName cache lookup (hybrid model — company string untouched)
  const bodyWithCompany = body as ContactInput & { companyId?: string }
  let resolvedCompanyId: string | undefined
  let resolvedCompanyName: string | undefined
  if (bodyWithCompany.companyId) {
    const loaded = await loadCompany(bodyWithCompany.companyId, orgId)
    if (!loaded) return apiError('Invalid companyId (not found or cross-tenant)', 400)
    resolvedCompanyId = bodyWithCompany.companyId
    resolvedCompanyName = loaded.data.name
  }

  const contactData = {
    orgId,
    capturedFromId,
    name: body.name.trim(),
    email: body.email.trim().toLowerCase(),
    phone: body.phone?.trim() ?? '',
    company: body.company?.trim() ?? '',
    website: body.website?.trim() ?? '',
    source: body.source ?? 'manual',
    type: body.type ?? 'lead',
    stage: body.stage ?? 'new',
    tags: body.tags ?? [],
    notes: body.notes?.trim() ?? '',
    assignedTo: body.assignedTo ?? '',
    assignedToRef,  // may be undefined; sanitize step will strip
    companyId: resolvedCompanyId,     // undefined if not provided; sanitize strips
    companyName: resolvedCompanyName, // undefined if not provided; sanitize strips
    deleted: false,
    subscribedAt: FieldValue.serverTimestamp(),
    unsubscribedAt: null,
    bouncedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastContactedAt: null,
    createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
    createdByRef: actorRef,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: actorRef,
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(
    Object.entries(contactData).filter(([, v]) => v !== undefined),
  )

  const docRef = adminDb.collection('contacts').doc()
  await docRef.set(sanitized)

  try {
    await dispatchWebhook(orgId, 'contact.created', {
      id: docRef.id,
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      phone: body.phone?.trim() ?? '',
      company: body.company?.trim() ?? '',
      source: body.source ?? 'manual',
      createdByRef: actorRef,
    })
  } catch (err) {
    console.error('[webhook-dispatch-error] contact.created', err)
  }

  logActivity({
    orgId,
    type: 'crm_contact_created',
    actorId: ctx.actor.uid,
    actorName: ctx.actor.displayName,
    actorRole: ctx.isAgent ? 'ai' : ctx.role === 'admin' ? 'admin' : 'client',
    description: `Created contact: "${body.name.trim()}"`,
    entityId: docRef.id,
    entityType: 'contact',
    entityTitle: body.name.trim(),
  }).catch(() => {})

  return apiSuccess({ id: docRef.id }, 201)
})
